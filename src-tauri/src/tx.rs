//! ARK Core v3 (AIP-11, version 2) transaction serialization and signing.

use crate::crypto::{self, sha256, KeyPair};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const TYPE_TRANSFER: u16 = 0;
pub const TYPE_SECOND_SIGNATURE: u16 = 1;
pub const TYPE_DELEGATE_REGISTRATION: u16 = 2;
pub const TYPE_VOTE: u16 = 3;
pub const TYPE_MULTI_PAYMENT: u16 = 6;
pub const TYPE_DELEGATE_RESIGNATION: u16 = 7;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TxData {
    pub version: u8,
    #[serde(default)]
    pub network: u8,
    pub type_group: u32,
    #[serde(rename = "type")]
    pub tx_type: u16,
    pub nonce: String,
    pub sender_public_key: String,
    pub fee: String,
    pub amount: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "recipient")]
    pub recipient_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "signSignature")]
    pub second_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

fn parse_u64(s: &str, what: &str) -> Result<u64, String> {
    s.trim().parse::<u64>().map_err(|_| format!("Invalid {what}: {s}"))
}

fn hex33(s: &str, what: &str) -> Result<[u8; 33], String> {
    let v = hex::decode(s).map_err(|_| format!("Invalid {what}"))?;
    v.try_into().map_err(|_| format!("Invalid {what} length"))
}

/// Serialize per AIP-11. `with_sig` / `with_second` control which signatures are appended.
pub fn serialize(tx: &TxData, with_sig: bool, with_second: bool) -> Result<Vec<u8>, String> {
    if tx.type_group != 1 {
        return Err(format!("Unsupported type group {}", tx.type_group));
    }
    let mut b: Vec<u8> = Vec::with_capacity(256);
    b.push(0xff);
    b.push(tx.version);
    b.push(tx.network);
    b.extend_from_slice(&tx.type_group.to_le_bytes());
    b.extend_from_slice(&tx.tx_type.to_le_bytes());
    b.extend_from_slice(&parse_u64(&tx.nonce, "nonce")?.to_le_bytes());
    b.extend_from_slice(&hex33(&tx.sender_public_key, "sender public key")?);
    b.extend_from_slice(&parse_u64(&tx.fee, "fee")?.to_le_bytes());

    match tx.vendor_field.as_deref() {
        Some(v) if !v.is_empty() => {
            let bytes = v.as_bytes();
            if bytes.len() > 255 {
                return Err("Memo (vendor field) is longer than 255 bytes".into());
            }
            b.push(bytes.len() as u8);
            b.extend_from_slice(bytes);
        }
        _ => b.push(0),
    }

    let asset = tx.asset.as_ref();
    match tx.tx_type {
        TYPE_TRANSFER => {
            b.extend_from_slice(&parse_u64(&tx.amount, "amount")?.to_le_bytes());
            b.extend_from_slice(&tx.expiration.unwrap_or(0).to_le_bytes());
            let r = tx.recipient_id.as_deref().ok_or("Missing recipient")?;
            b.extend_from_slice(&crypto::decode_address(r, tx.network)?);
        }
        TYPE_SECOND_SIGNATURE => {
            let pk = asset
                .and_then(|a| a.pointer("/signature/publicKey"))
                .and_then(Value::as_str)
                .ok_or("Missing second public key")?;
            b.extend_from_slice(&hex33(pk, "second public key")?);
        }
        TYPE_DELEGATE_REGISTRATION => {
            let u = asset
                .and_then(|a| a.pointer("/delegate/username"))
                .and_then(Value::as_str)
                .ok_or("Missing delegate username")?;
            b.push(u.len() as u8);
            b.extend_from_slice(u.as_bytes());
        }
        TYPE_VOTE => {
            let votes = asset
                .and_then(|a| a.get("votes"))
                .and_then(Value::as_array)
                .ok_or("Missing votes")?;
            b.push(votes.len() as u8);
            for v in votes {
                let v = v.as_str().ok_or("Invalid vote")?;
                let (prefix, pk) = match v.split_at(1) {
                    ("+", pk) => (1u8, pk),
                    ("-", pk) => (0u8, pk),
                    _ => return Err(format!("Invalid vote {v}")),
                };
                b.push(prefix);
                b.extend_from_slice(&hex33(pk, "delegate public key")?);
            }
        }
        TYPE_MULTI_PAYMENT => {
            let payments = asset
                .and_then(|a| a.get("payments"))
                .and_then(Value::as_array)
                .ok_or("Missing payments")?;
            b.extend_from_slice(&(payments.len() as u16).to_le_bytes());
            for p in payments {
                let amount = p
                    .get("amount")
                    .and_then(|a| a.as_str().map(str::to_string).or_else(|| a.as_u64().map(|n| n.to_string())))
                    .ok_or("Invalid payment amount")?;
                b.extend_from_slice(&parse_u64(&amount, "payment amount")?.to_le_bytes());
                let r = p.get("recipientId").and_then(Value::as_str).ok_or("Invalid payment recipient")?;
                b.extend_from_slice(&crypto::decode_address(r, tx.network)?);
            }
        }
        TYPE_DELEGATE_RESIGNATION => {}
        t => return Err(format!("Unsupported transaction type {t}")),
    }

    if with_sig {
        if let Some(s) = &tx.signature {
            b.extend_from_slice(&hex::decode(s).map_err(|_| "Invalid signature hex")?);
        }
    }
    if with_second {
        if let Some(s) = &tx.second_signature {
            b.extend_from_slice(&hex::decode(s).map_err(|_| "Invalid second signature hex")?);
        }
    }
    Ok(b)
}

pub fn compute_id(tx: &TxData) -> Result<String, String> {
    Ok(hex::encode(sha256(&serialize(tx, true, true)?)))
}

/// Verify the first (and second, when `second_public_key` is given) signature.
pub fn verify(tx: &TxData, second_public_key: Option<&str>) -> Result<bool, String> {
    let sender = hex::decode(&tx.sender_public_key).map_err(|_| "bad sender key")?;
    let sig = hex::decode(tx.signature.as_deref().ok_or("unsigned")?).map_err(|_| "bad sig")?;
    let h1 = sha256(&serialize(tx, false, false)?);
    if !crypto::verify_any(&h1, &sig, &sender) {
        return Ok(false);
    }
    if let Some(spk) = second_public_key {
        let spk = hex::decode(spk).map_err(|_| "bad second key")?;
        let sig2 = hex::decode(tx.second_signature.as_deref().ok_or("missing second signature")?)
            .map_err(|_| "bad second sig")?;
        let h2 = sha256(&serialize(tx, true, false)?);
        if !crypto::verify_any(&h2, &sig2, &spk) {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub amount: String,
    pub recipient_id: String,
}

/// What the UI asks us to build. Passphrases are used once and dropped.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    /// Network pubKeyHash byte (23 mainnet, 30 devnet)
    pub network: u8,
    /// transfer | multipayment | vote | secondSignature | delegateRegistration | delegateResignation
    pub kind: String,
    pub nonce: String,
    pub fee: String,
    pub amount: Option<String>,
    pub recipient_id: Option<String>,
    pub vendor_field: Option<String>,
    pub payments: Option<Vec<Payment>>,
    pub votes: Option<Vec<String>>,
    pub username: Option<String>,
    pub expected_address: String,
    pub expected_second_public_key: Option<String>,
    pub passphrase: String,
    pub second_passphrase: Option<String>,
    pub new_second_passphrase: Option<String>,
}

impl Drop for BuildRequest {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.passphrase.zeroize();
        if let Some(p) = self.second_passphrase.as_mut() {
            p.zeroize();
        }
        if let Some(p) = self.new_second_passphrase.as_mut() {
            p.zeroize();
        }
    }
}

pub fn build_and_sign(req: &BuildRequest) -> Result<TxData, String> {
    let keys = KeyPair::from_passphrase(req.passphrase.trim())?;
    let derived = crypto::address_from_public_key(&keys.public, req.network);
    if derived != req.expected_address {
        return Err("This passphrase does not belong to this wallet".into());
    }

    let second_keys = match (&req.expected_second_public_key, &req.second_passphrase) {
        (Some(spk), Some(p)) => {
            let k = KeyPair::from_passphrase(p.trim())?;
            if &k.public_hex() != spk {
                return Err("The second passphrase is not correct for this wallet".into());
            }
            Some(k)
        }
        (Some(_), None) => return Err("This wallet requires its second passphrase".into()),
        _ => None,
    };

    // The memo is published on the chain for good: refuse one that is a passphrase
    if let Some(memo) = req.vendor_field.as_deref() {
        let mut keys_of_wallet: Vec<&[u8]> = vec![&keys.public];
        if let Some(k) = &second_keys {
            keys_of_wallet.push(&k.public);
        }
        let new_second = match req.new_second_passphrase.as_deref() {
            Some(p) => Some(KeyPair::from_passphrase(p.trim())?),
            None => None,
        };
        if let Some(k) = &new_second {
            keys_of_wallet.push(&k.public);
        }
        if crypto::looks_like_secret(memo, &keys_of_wallet) {
            return Err("The memo looks like a passphrase. Memos are public and stay on the blockchain forever, so this transaction was not signed.".into());
        }
    }

    let mut tx = TxData {
        version: 2,
        network: req.network,
        type_group: 1,
        tx_type: 0,
        nonce: req.nonce.clone(),
        sender_public_key: keys.public_hex(),
        fee: req.fee.clone(),
        amount: "0".into(),
        expiration: None,
        recipient_id: None,
        vendor_field: None,
        asset: None,
        signature: None,
        second_signature: None,
        id: None,
    };
    parse_u64(&tx.fee, "fee")?;
    parse_u64(&tx.nonce, "nonce")?;
    let memo = req.vendor_field.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    match req.kind.as_str() {
        "transfer" => {
            tx.tx_type = TYPE_TRANSFER;
            let amount = req.amount.clone().ok_or("Missing amount")?;
            if parse_u64(&amount, "amount")? == 0 {
                return Err("Amount must be greater than zero".into());
            }
            tx.amount = amount;
            tx.expiration = Some(0);
            let r = req.recipient_id.as_deref().ok_or("Missing recipient")?.trim().to_string();
            crypto::decode_address(&r, req.network)?;
            tx.recipient_id = Some(r);
            tx.vendor_field = memo;
        }
        "multipayment" => {
            tx.tx_type = TYPE_MULTI_PAYMENT;
            let payments = req.payments.as_ref().ok_or("Missing payments")?;
            if payments.len() < 2 || payments.len() > 64 {
                return Err("A multipayment needs between 2 and 64 recipients".into());
            }
            let mut out = Vec::new();
            for p in payments {
                let r = p.recipient_id.trim();
                crypto::decode_address(r, req.network)?;
                if parse_u64(&p.amount, "amount")? == 0 {
                    return Err(format!("Amount for {r} must be greater than zero"));
                }
                out.push(json!({ "amount": p.amount, "recipientId": r }));
            }
            tx.asset = Some(json!({ "payments": out }));
            tx.vendor_field = memo;
        }
        "vote" => {
            tx.tx_type = TYPE_VOTE;
            let votes = req.votes.as_ref().ok_or("Missing votes")?;
            // Allowed: ["+pk"] vote, ["-pk"] unvote, ["-old", "+new"] switch (unvote must come first)
            let ok = match votes.as_slice() {
                [v] => v.starts_with('+') || v.starts_with('-'),
                [a, b] => a.starts_with('-') && b.starts_with('+') && a[1..] != b[1..],
                _ => false,
            };
            if !ok {
                return Err("A vote transaction is a vote, an unvote, or an unvote followed by a vote".into());
            }
            tx.asset = Some(json!({ "votes": votes }));
        }
        "secondSignature" => {
            tx.tx_type = TYPE_SECOND_SIGNATURE;
            if req.expected_second_public_key.is_some() {
                return Err("This wallet already has a second passphrase".into());
            }
            let p = req.new_second_passphrase.as_deref().ok_or("Missing new second passphrase")?;
            let k2 = KeyPair::from_passphrase(p.trim())?;
            tx.asset = Some(json!({ "signature": { "publicKey": k2.public_hex() } }));
        }
        "delegateRegistration" => {
            tx.tx_type = TYPE_DELEGATE_REGISTRATION;
            let u = req.username.as_deref().ok_or("Missing username")?.trim().to_string();
            let ok = !u.is_empty()
                && u.len() <= 20
                && u.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "!@$&_.".contains(c));
            if !ok {
                return Err("Username: 1-20 chars, lowercase letters, digits and !@$&_.".into());
            }
            tx.asset = Some(json!({ "delegate": { "username": u } }));
        }
        "delegateResignation" => {
            tx.tx_type = TYPE_DELEGATE_RESIGNATION;
        }
        k => return Err(format!("Unknown transaction kind {k}")),
    }

    let h1 = sha256(&serialize(&tx, false, false)?);
    tx.signature = Some(hex::encode(keys.sign_schnorr(&h1)));
    if let Some(k2) = &second_keys {
        let h2 = sha256(&serialize(&tx, true, false)?);
        tx.second_signature = Some(hex::encode(k2.sign_schnorr(&h2)));
    }
    tx.id = Some(compute_id(&tx)?);

    let spk = second_keys.as_ref().map(|k| k.public_hex());
    if !verify(&tx, spk.as_deref())? {
        return Err("Internal error: signature self-check failed".into());
    }
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real mainnet transactions fetched from api.ark.io (tests/fixtures/mainnet_txs.json).
    /// Re-serializing must reproduce the on-chain id and the signatures must verify.
    #[test]
    fn mainnet_fixtures_roundtrip() {
        let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/mainnet_txs.json"))
            .expect("fixture file");
        let list: Vec<Value> = serde_json::from_str(&raw).unwrap();
        assert!(!list.is_empty());
        for v in list {
            let mut tx: TxData = serde_json::from_value(v.clone()).unwrap();
            tx.network = 23;
            let want = v["id"].as_str().unwrap();
            assert_eq!(compute_id(&tx).unwrap(), want, "id mismatch for type {}", tx.tx_type);
            let spk = v.get("_secondPublicKey").and_then(Value::as_str);
            assert!(verify(&tx, spk).unwrap(), "signature failed for {want} (type {})", tx.tx_type);
        }
    }

    fn req(kind: &str) -> BuildRequest {
        let kp = KeyPair::from_passphrase("this is a top secret passphrase").unwrap();
        BuildRequest {
            network: 30,
            kind: kind.into(),
            nonce: "1".into(),
            fee: "10000000".into(),
            amount: Some("100000000".into()),
            recipient_id: Some("D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib".into()),
            vendor_field: Some("hi".into()),
            payments: None,
            votes: Some(vec!["+034151a3ec46b5670a682b0a63394f863587d1bc97483b1b6c70eb58e7f0aed192".into()]),
            username: Some("tester".into()),
            expected_address: crypto::address_from_public_key(&kp.public, 30),
            expected_second_public_key: None,
            passphrase: "this is a top secret passphrase".into(),
            second_passphrase: None,
            new_second_passphrase: Some("second".into()),
        }
    }

    #[test]
    fn build_all_kinds() {
        for k in ["transfer", "vote", "secondSignature", "delegateRegistration", "delegateResignation"] {
            let tx = build_and_sign(&req(k)).unwrap();
            assert!(tx.id.is_some());
        }
        let mut r = req("multipayment");
        r.payments = Some(vec![
            Payment { amount: "1".into(), recipient_id: "D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib".into() },
            Payment { amount: "2".into(), recipient_id: "D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib".into() },
        ]);
        build_and_sign(&r).unwrap();
    }

    /// The UI computes the minimum fee from this size formula (src/lib/fees.ts) - keep them in sync.
    fn formula_size(kind: &str, memo: usize, n: usize, uname: usize, second: bool) -> usize {
        let base = 59 + memo;
        let asset = match kind {
            "transfer" => 33,
            "multipayment" => 2 + 29 * n,
            "vote" => 1 + 34 * n,
            "secondSignature" => 33,
            "delegateRegistration" => 1 + uname,
            _ => 0,
        };
        base + asset + 64 + if second { 64 } else { 0 }
    }

    #[test]
    fn size_formula_matches_serializer() {
        for k in ["transfer", "vote", "secondSignature", "delegateRegistration", "delegateResignation"] {
            let r = req(k);
            let tx = build_and_sign(&r).unwrap();
            let memo = if matches!(k, "transfer") { 2 } else { 0 };
            assert_eq!(serialize(&tx, true, true).unwrap().len(), formula_size(k, memo, 1, 6, false), "{k}");
        }
        let k2 = KeyPair::from_passphrase("second").unwrap();
        let mut r = req("multipayment");
        r.expected_second_public_key = Some(k2.public_hex());
        r.second_passphrase = Some("second".into());
        r.payments = Some((0..5).map(|i| Payment { amount: (i + 1).to_string(), recipient_id: "D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib".into() }).collect());
        let tx = build_and_sign(&r).unwrap();
        assert_eq!(serialize(&tx, true, true).unwrap().len(), formula_size("multipayment", 2, 5, 0, true));
    }

    #[test]
    fn vote_switch_rules() {
        let a = "+034151a3ec46b5670a682b0a63394f863587d1bc97483b1b6c70eb58e7f0aed192";
        let b = "-020431436cf94f3c6a6ba566fe9e42678db8486590c732ca6c3803a10a86f50b92";
        let mut r = req("vote");
        r.votes = Some(vec![b.into(), a.into()]);
        let tx = build_and_sign(&r).unwrap();
        assert_eq!(serialize(&tx, true, true).unwrap().len(), formula_size("vote", 0, 2, 0, false));
        r.votes = Some(vec![a.into(), b.into()]); // vote before unvote: rejected
        assert!(build_and_sign(&r).is_err());
        r.votes = Some(vec![b.into()]); // plain unvote
        assert!(build_and_sign(&r).is_ok());
    }

    #[test]
    fn refuses_passphrase_as_memo() {
        let mut r = req("transfer");
        r.vendor_field = Some(" this is a top secret passphrase ".into());
        assert!(build_and_sign(&r).unwrap_err().contains("memo looks like a passphrase"));
        r.vendor_field = Some(crypto::generate_mnemonic(12).unwrap());
        assert!(build_and_sign(&r).is_err());
        r.vendor_field = Some("invoice 42".into());
        assert!(build_and_sign(&r).is_ok());
    }

    #[test]
    fn rejects_wrong_passphrase_and_network() {
        let mut r = req("transfer");
        r.passphrase = "nope".into();
        assert!(build_and_sign(&r).is_err());
        let mut r = req("transfer");
        r.recipient_id = Some("AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj".into());
        assert!(build_and_sign(&r).is_err());
    }

    #[test]
    fn second_signature_flow() {
        let k2 = KeyPair::from_passphrase("second").unwrap();
        let mut r = req("transfer");
        r.expected_second_public_key = Some(k2.public_hex());
        assert!(build_and_sign(&r).is_err());
        r.second_passphrase = Some("second".into());
        let tx = build_and_sign(&r).unwrap();
        assert!(verify(&tx, Some(&k2.public_hex())).unwrap());
    }
}

#[cfg(test)]
mod live {
    use super::*;
    /// `cargo test print_devnet_tx -- --ignored --nocapture` prints a signed devnet tx from a throwaway key.
    #[test]
    #[ignore]
    fn print_devnet_tx() {
        let pass = std::env::var("ARK_TEST_PASS").unwrap_or_else(|_| "throwaway devnet key for signature check".into());
        let kp = KeyPair::from_passphrase(&pass).unwrap();
        let kind = std::env::var("ARK_TEST_KIND").unwrap_or_else(|_| "transfer".into());
        let r = BuildRequest {
            network: 30,
            kind,
            nonce: "1".into(),
            fee: std::env::var("ARK_TEST_FEE").unwrap_or_else(|_| "10000000".into()),
            amount: Some("1".into()),
            recipient_id: Some("D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib".into()),
            vendor_field: Some("sig check".into()),
            payments: None,
            votes: Some(vec!["+03f1e42f6ab3cda2ea17ee5ad5b84d6f9da10b39e0a9a2e3ee68c87eac56a11f1d".into()]),
            username: None,
            expected_address: crypto::address_from_public_key(&kp.public, 30),
            expected_second_public_key: None,
            passphrase: pass,
            second_passphrase: None,
            new_second_passphrase: None,
        };
        println!("TXJSON {}", serde_json::to_string(&json!({ "transactions": [build_and_sign(&r).unwrap()] })).unwrap());
    }
}
