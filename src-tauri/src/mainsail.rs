//! Mainsail (ARK on an EVM): addresses, transactions, legacy second signatures, contract calls,
//! signed messages and validator (BLS) keys.
//!
//! - Keys are the Core v3 ones: private key = sha256(passphrase) on secp256k1, so one passphrase
//!   controls its old ARK address and its Mainsail address.
//! - Address = Ethereum address of that key (keccak256 of the uncompressed public key), EIP-55.
//! - Transactions are EIP-155 "legacy" Ethereum transactions:
//!   rlp([nonce, gasPrice, gasLimit, to, value, data, v, r, s]), v = recid + chainId * 2 + 35,
//!   signed over keccak(rlp([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])).
//! - Wallets that registered a second passphrase on Core v3 add a 10th RLP field: a recoverable
//!   ECDSA signature (r || s || recid) by the second key over keccak(0x8f || "MAINSAIL_LSS_V1" || id),
//!   where id = keccak of the signed transaction without that field (the transaction hash).
//! - Votes, multipayments, usernames and validator registration are calls to system contracts.
//! - Messages are EIP-191 ("\x19Ethereum Signed Message:\n" + length + message).
//! - Validator keys: BLS12-381 (public key in G1, 48 bytes), derived from a BIP39 mnemonic with
//!   EIP-2333 (master from the seed, child 0) exactly as the Mainsail node does, plus a proof of
//!   possession over abi.encodePacked(chainId, registrant address, public key).
//!
//! Checked against the official SDK fixtures (ArkEcosystem/python-crypto, branch feat/mainsail)
//! and the node's own vectors (ArkEcosystem/mainsail), see the tests below.

use crate::crypto::{self, KeyPair};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use zeroize::{Zeroize, Zeroizing};

pub const CONSENSUS: &str = "0x535B3D7A252fa034Ed71F0C53ec0C6F784cB64E1";
pub const MULTIPAYMENT: &str = "0x00EFd0D4639191C49908A7BddbB9A11A994A8527";
pub const USERNAMES: &str = "0x2c1DE3b4Dbb4aDebEbB5dcECAe825bE2a9fc6eb6";

/// 1 ARK = 1e18 wei on Mainsail; the app counts in arktoshi (1e-8 ARK) everywhere.
pub const WEI_PER_ARKTOSHI: u128 = 10_000_000_000;

const LSS_DOMAIN: &[u8] = b"\x8fMAINSAIL_LSS_V1";
const POP_DST: &[u8] = b"MAINSAIL_BLS_POP_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
const MULTIPAYMENT_LIMIT: usize = 256;

pub fn keccak(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

// ---------- addresses ----------

/// EIP-55 mixed-case checksum form of a 20-byte address.
pub fn checksum(raw: &[u8; 20]) -> String {
    let lower = hex::encode(raw);
    let h = keccak(lower.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, c) in lower.chars().enumerate() {
        let nibble = (h[i / 2] >> (if i % 2 == 0 { 4 } else { 0 })) & 0x0f;
        out.push(if c.is_ascii_alphabetic() && nibble >= 8 { c.to_ascii_uppercase() } else { c });
    }
    out
}

/// Mainsail address of a secp256k1 public key (compressed or not).
pub fn address_bytes(pubkey: &[u8]) -> Result<[u8; 20], String> {
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    let pk = k256::PublicKey::from_sec1_bytes(pubkey).map_err(|_| "Invalid public key")?;
    let point = pk.to_encoded_point(false);
    let h = keccak(&point.as_bytes()[1..]);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    Ok(a)
}

pub fn address_from_public_key(pubkey: &[u8]) -> Result<String, String> {
    Ok(checksum(&address_bytes(pubkey)?))
}

/// Parse a 0x address. Mixed case must carry a valid EIP-55 checksum (a typo is caught);
/// all-lower or all-upper case has no checksum to check. Errors never echo the input.
pub fn parse_address(s: &str) -> Result<[u8; 20], String> {
    let s = s.trim();
    let body = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).ok_or("Invalid address")?;
    if body.len() != 40 || !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid address".into());
    }
    let raw: [u8; 20] = hex::decode(body).map_err(|_| "Invalid address")?.try_into().map_err(|_| "Invalid address")?;
    let mixed = body.chars().any(|c| c.is_ascii_lowercase()) && body.chars().any(|c| c.is_ascii_uppercase());
    if mixed && checksum(&raw)[2..] != *body {
        return Err("Address checksum does not match (typo?)".into());
    }
    Ok(raw)
}

// ---------- RLP ----------

fn be_trim(v: u128) -> Vec<u8> {
    let b = v.to_be_bytes();
    let first = b.iter().position(|&x| x != 0).unwrap_or(b.len());
    b[first..].to_vec()
}

fn rlp_len_prefix(len: usize, short: u8, long: u8, out: &mut Vec<u8>) {
    if len <= 55 {
        out.push(short + len as u8);
    } else {
        let l = be_trim(len as u128);
        out.push(long + l.len() as u8);
        out.extend_from_slice(&l);
    }
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len() + 9);
    if b.len() == 1 && b[0] < 0x80 {
        out.push(b[0]);
    } else {
        rlp_len_prefix(b.len(), 0x80, 0xb7, &mut out);
        out.extend_from_slice(b);
    }
    out
}

fn rlp_uint(v: u128) -> Vec<u8> {
    rlp_bytes(&be_trim(v))
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload: Vec<u8> = items.concat();
    let mut out = Vec::with_capacity(payload.len() + 9);
    rlp_len_prefix(payload.len(), 0xc0, 0xf7, &mut out);
    out.extend_from_slice(&payload);
    out
}

fn strip_leading_zeros(b: &[u8]) -> &[u8] {
    let first = b.iter().position(|&x| x != 0).unwrap_or(b.len());
    &b[first..]
}

// ---------- transactions ----------

#[derive(Clone, Debug)]
pub struct EvmTx {
    pub chain_id: u64,
    pub nonce: u64,
    pub gas_price: u128,
    pub gas_limit: u64,
    pub to: [u8; 20],
    pub value: u128,
    pub data: Vec<u8>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignedTx {
    /// transaction hash (id), hex without 0x
    pub hash: String,
    /// what is broadcast: hex without 0x
    pub serialized: String,
    pub from: String,
    pub to: String,
    pub nonce: String,
    pub gas_price: String,
    pub gas_limit: String,
    /// wei
    pub value: String,
    /// hex without 0x
    pub data: String,
    pub v: u8,
    pub r: String,
    pub s: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_second_signature: Option<String>,
}

impl EvmTx {
    fn base_fields(&self) -> Vec<Vec<u8>> {
        vec![
            rlp_uint(self.nonce as u128),
            rlp_uint(self.gas_price),
            rlp_uint(self.gas_limit as u128),
            rlp_bytes(&self.to),
            rlp_uint(self.value),
            rlp_bytes(&self.data),
        ]
    }

    /// keccak(rlp([..., chainId, 0, 0])): what the sender signs (EIP-155)
    pub fn signing_hash(&self) -> [u8; 32] {
        let mut f = self.base_fields();
        f.push(rlp_uint(self.chain_id as u128));
        f.push(rlp_uint(0));
        f.push(rlp_uint(0));
        keccak(&rlp_list(&f))
    }

    fn signed_rlp(&self, rs: &[u8; 64], recid: u8, lss: Option<&[u8; 65]>) -> Vec<u8> {
        let mut f = self.base_fields();
        f.push(rlp_uint(recid as u128 + self.chain_id as u128 * 2 + 35));
        f.push(rlp_bytes(strip_leading_zeros(&rs[..32])));
        f.push(rlp_bytes(strip_leading_zeros(&rs[32..])));
        if let Some(l) = lss {
            f.push(rlp_bytes(l));
        }
        rlp_list(&f)
    }

    pub fn sign(&self, keys: &KeyPair, second: Option<&KeyPair>) -> Result<SignedTx, String> {
        let (rs, recid) = keys.sign_recoverable(&self.signing_hash())?;
        let without_lss = self.signed_rlp(&rs, recid, None);
        let hash = keccak(&without_lss);
        let lss = match second {
            Some(k2) => {
                let mut msg = LSS_DOMAIN.to_vec();
                msg.extend_from_slice(&hash);
                let (rs2, recid2) = k2.sign_recoverable(&keccak(&msg))?;
                let mut out = [0u8; 65];
                out[..64].copy_from_slice(&rs2);
                out[64] = recid2;
                Some(out)
            }
            None => None,
        };
        let serialized = match &lss {
            Some(l) => self.signed_rlp(&rs, recid, Some(l)),
            None => without_lss,
        };
        // check our own signature before anything leaves the machine
        let recovered = recover(&self.signing_hash(), &rs, recid)?;
        if recovered != keys.public {
            return Err("Signature self-check failed".into());
        }
        Ok(SignedTx {
            hash: hex::encode(hash),
            serialized: hex::encode(serialized),
            from: address_from_public_key(&keys.public)?,
            to: checksum(&self.to),
            nonce: self.nonce.to_string(),
            gas_price: self.gas_price.to_string(),
            gas_limit: self.gas_limit.to_string(),
            value: self.value.to_string(),
            data: hex::encode(&self.data),
            v: recid,
            r: hex::encode(&rs[..32]),
            s: hex::encode(&rs[32..]),
            legacy_second_signature: lss.map(hex::encode),
        })
    }
}

/// Recover the compressed public key from a recoverable signature over a 32-byte hash.
pub fn recover(hash: &[u8; 32], rs: &[u8; 64], recid: u8) -> Result<[u8; 33], String> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
    let sig = Signature::from_slice(rs).map_err(|_| "Invalid signature")?;
    let rid = RecoveryId::from_byte(recid).ok_or("Invalid signature recovery id")?;
    let vk = VerifyingKey::recover_from_prehash(hash, &sig, rid).map_err(|_| "Invalid signature")?;
    vk.to_encoded_point(true).as_bytes().try_into().map_err(|_| "Invalid signature".to_string())
}

// ---------- contract calls (Solidity ABI) ----------

fn selector(sig: &str) -> [u8; 4] {
    let h = keccak(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}

fn word_uint(v: u128) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&v.to_be_bytes());
    w
}

fn word_address(a: &[u8; 20]) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(a);
    w
}

enum Arg<'a> {
    Address([u8; 20]),
    Bytes(&'a [u8]),
    AddressArray(&'a [[u8; 20]]),
    UintArray(&'a [u128]),
}

fn encode_call(sig: &str, args: &[Arg]) -> Vec<u8> {
    let mut head: Vec<u8> = Vec::new();
    let mut tail: Vec<u8> = Vec::new();
    let head_len = 32 * args.len();
    for a in args {
        match a {
            Arg::Address(x) => head.extend_from_slice(&word_address(x)),
            Arg::Bytes(b) => {
                head.extend_from_slice(&word_uint((head_len + tail.len()) as u128));
                tail.extend_from_slice(&word_uint(b.len() as u128));
                tail.extend_from_slice(b);
                tail.resize(tail.len() + (32 - b.len() % 32) % 32, 0);
            }
            Arg::AddressArray(xs) => {
                head.extend_from_slice(&word_uint((head_len + tail.len()) as u128));
                tail.extend_from_slice(&word_uint(xs.len() as u128));
                for x in xs.iter() {
                    tail.extend_from_slice(&word_address(x));
                }
            }
            Arg::UintArray(xs) => {
                head.extend_from_slice(&word_uint((head_len + tail.len()) as u128));
                tail.extend_from_slice(&word_uint(xs.len() as u128));
                for x in xs.iter() {
                    tail.extend_from_slice(&word_uint(*x));
                }
            }
        }
    }
    let mut out = selector(sig).to_vec();
    out.extend_from_slice(&head);
    out.extend_from_slice(&tail);
    out
}

// ---------- validator keys (BLS12-381) ----------

/// The validator's BLS secret key from its BIP39 mnemonic, as the Mainsail node derives it
/// (`deriveChild(deriveMaster(mnemonicToSeed(mnemonic)), 0)`, EIP-2333).
pub fn bls_secret(mnemonic: &str) -> Result<blst::min_pk::SecretKey, String> {
    let words = Zeroizing::new(mnemonic.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase());
    let m = bip39::Mnemonic::parse_in_normalized(bip39::Language::English, &words)
        .map_err(|_| "The validator passphrase is not a valid BIP39 mnemonic (check the words)")?;
    let seed = Zeroizing::new(m.to_seed_normalized(""));
    let master = blst::min_pk::SecretKey::derive_master_eip2333(seed.as_ref()).map_err(|_| "BLS key derivation failed")?;
    Ok(master.derive_child_eip2333(0))
}

pub fn bls_public(sk: &blst::min_pk::SecretKey) -> [u8; 48] {
    sk.sk_to_pk().compress()
}

/// Proof of possession bound to the chain and the registering address.
pub fn proof_of_possession(sk: &blst::min_pk::SecretKey, chain_id: u64, registrant: &[u8; 20]) -> [u8; 96] {
    let pk = bls_public(sk);
    let mut msg = Vec::with_capacity(32 + 20 + 48);
    msg.extend_from_slice(&word_uint(chain_id as u128));
    msg.extend_from_slice(registrant);
    msg.extend_from_slice(&pk);
    sk.sign(&msg, POP_DST, &[]).compress()
}

// ---------- building ----------

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    /// arktoshi
    pub amount: String,
    pub recipient_id: String,
}

/// What a transaction does, without keys: enough to estimate its gas.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallRequest {
    pub kind: String,
    /// arktoshi
    pub amount: Option<String>,
    pub recipient_id: Option<String>,
    pub memo: Option<String>,
    pub payments: Option<Vec<Payment>>,
    /// validator address to vote for
    pub vote: Option<String>,
    pub username: Option<String>,
    /// validator BLS public key and proof of possession (hex); filled in by `build` from the
    /// validator passphrase, or dummies when only estimating
    #[serde(skip)]
    pub bls: Option<([u8; 48], Option<[u8; 96]>)>,
    /// register with the older `registerValidator(bytes)` (no proof of possession), for networks
    /// whose consensus contract predates it
    #[serde(default)]
    pub legacy_registration: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub to: String,
    /// wei
    pub value: String,
    /// 0x-prefixed hex
    pub data: String,
}

fn arktoshi_to_wei(s: &str, what: &str) -> Result<u128, String> {
    let v: u128 = s.trim().parse().map_err(|_| format!("Invalid {what}"))?;
    v.checked_mul(WEI_PER_ARKTOSHI).ok_or_else(|| format!("{what} is too large"))
}

fn parse_contract(a: &str) -> [u8; 20] {
    parse_address(a).expect("built-in contract address")
}

pub fn valid_username(u: &str) -> bool {
    // Mainsail usernames: 1-20 characters, lowercase letters, digits and underscores, not starting
    // or ending with an underscore nor containing two in a row
    let ok_chars = u.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    (1..=20).contains(&u.len()) && ok_chars && !u.starts_with('_') && !u.ends_with('_') && !u.contains("__")
}

/// The contract call (or plain transfer) a request describes: (to, value in wei, data).
pub fn call_for(req: &CallRequest) -> Result<([u8; 20], u128, Vec<u8>), String> {
    match req.kind.as_str() {
        "transfer" => {
            let value = arktoshi_to_wei(req.amount.as_deref().ok_or("Missing amount")?, "amount")?;
            if value == 0 {
                return Err("Amount must be greater than zero".into());
            }
            let to = parse_address(req.recipient_id.as_deref().ok_or("Missing recipient")?)?;
            let memo = req.memo.as_deref().map(str::trim).unwrap_or("");
            if memo.len() > 255 {
                return Err("The memo is longer than 255 bytes".into());
            }
            Ok((to, value, memo.as_bytes().to_vec()))
        }
        "multipayment" => {
            let payments = req.payments.as_ref().ok_or("Missing payments")?;
            if payments.len() < 2 || payments.len() > MULTIPAYMENT_LIMIT {
                return Err(format!("A multipayment needs between 2 and {MULTIPAYMENT_LIMIT} recipients"));
            }
            let mut to = Vec::with_capacity(payments.len());
            let mut amounts = Vec::with_capacity(payments.len());
            for p in payments {
                to.push(parse_address(&p.recipient_id)?);
                let a = arktoshi_to_wei(&p.amount, "amount")?;
                if a == 0 {
                    return Err("Every amount must be greater than zero".into());
                }
                amounts.push(a);
            }
            let total = amounts.iter().try_fold(0u128, |s, a| s.checked_add(*a)).ok_or("Total is too large")?;
            let data = encode_call("pay(address[],uint256[])", &[Arg::AddressArray(&to), Arg::UintArray(&amounts)]);
            Ok((parse_contract(MULTIPAYMENT), total, data))
        }
        "vote" => {
            let v = parse_address(req.vote.as_deref().ok_or("Missing validator")?)?;
            Ok((parse_contract(CONSENSUS), 0, encode_call("vote(address)", &[Arg::Address(v)])))
        }
        "unvote" => Ok((parse_contract(CONSENSUS), 0, encode_call("unvote()", &[]))),
        "validatorRegistration" | "validatorUpdate" => {
            let (pk, pop) = req.bls.ok_or("Missing validator key")?;
            let reg = req.kind == "validatorRegistration";
            let value = if reg { arktoshi_to_wei(req.amount.as_deref().ok_or("Missing amount")?, "amount")? } else { 0 };
            let data = match (req.legacy_registration, pop) {
                (true, _) => encode_call(
                    if reg { "registerValidator(bytes)" } else { "updateValidator(bytes)" },
                    &[Arg::Bytes(&pk)],
                ),
                (false, Some(pop)) => encode_call(
                    if reg { "registerValidator(bytes,bytes)" } else { "updateValidator(bytes,bytes)" },
                    &[Arg::Bytes(&pk), Arg::Bytes(&pop)],
                ),
                (false, None) => return Err("Missing proof of possession".into()),
            };
            Ok((parse_contract(CONSENSUS), value, data))
        }
        "validatorResignation" => Ok((parse_contract(CONSENSUS), 0, encode_call("resignValidator()", &[]))),
        "usernameRegistration" => {
            let u = req.username.as_deref().ok_or("Missing username")?.trim().to_string();
            if !valid_username(&u) {
                return Err("Usernames are 1-20 lowercase letters, digits or single underscores (not at the start or end)".into());
            }
            // a single dynamic string argument: same layout as bytes
            let mut data = selector("registerUsername(string)").to_vec();
            data.extend_from_slice(&encode_call("x()", &[Arg::Bytes(u.as_bytes())])[4..]);
            Ok((parse_contract(USERNAMES), 0, data))
        }
        "usernameResignation" => Ok((parse_contract(USERNAMES), 0, encode_call("resignUsername()", &[]))),
        k => Err(format!("Unsupported transaction kind: {k}")),
    }
}

/// The call a request makes, for a gas estimate (no keys involved). Validator registrations use
/// a placeholder key, which is the same size as the real one.
pub fn describe_call(mut req: CallRequest) -> Result<Call, String> {
    if req.kind == "validatorRegistration" || req.kind == "validatorUpdate" {
        req.bls = Some(([0u8; 48], Some([0u8; 96])));
    }
    let (to, value, data) = call_for(&req)?;
    Ok(Call { to: checksum(&to), value: value.to_string(), data: format!("0x{}", hex::encode(data)) })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub chain_id: u64,
    pub nonce: String,
    /// wei
    pub gas_price: String,
    pub gas_limit: String,
    #[serde(flatten)]
    pub call: CallRequest,
    pub passphrase: String,
    pub second_passphrase: Option<String>,
    /// BIP39 mnemonic of the validator's BLS key (validator registration / key update)
    pub validator_passphrase: Option<String>,
    pub expected_address: String,
    pub expected_second_public_key: Option<String>,
}

impl Drop for BuildRequest {
    fn drop(&mut self) {
        self.passphrase.zeroize();
        if let Some(p) = self.second_passphrase.as_mut() {
            p.zeroize();
        }
        if let Some(p) = self.validator_passphrase.as_mut() {
            p.zeroize();
        }
    }
}

pub fn build_and_sign(req: &mut BuildRequest) -> Result<SignedTx, String> {
    let keys = KeyPair::from_passphrase(req.passphrase.trim())?;
    let from = address_from_public_key(&keys.public)?;
    if !from.eq_ignore_ascii_case(req.expected_address.trim()) {
        return Err("This passphrase does not belong to this wallet".into());
    }
    let second = match (&req.expected_second_public_key, &req.second_passphrase) {
        (Some(spk), Some(p)) if !spk.is_empty() => {
            let k = KeyPair::from_passphrase(p.trim())?;
            if !k.public_hex().eq_ignore_ascii_case(spk) {
                return Err("The second passphrase is not correct for this wallet".into());
            }
            Some(k)
        }
        (Some(spk), None) if !spk.is_empty() => return Err("This wallet requires its second passphrase".into()),
        _ => None,
    };

    // The memo is published on the chain for good: refuse one that is a passphrase
    if let Some(memo) = req.call.memo.as_deref() {
        let mut ks: Vec<&[u8]> = vec![&keys.public];
        if let Some(k) = &second {
            ks.push(&k.public);
        }
        if crypto::looks_like_secret(memo, &ks) {
            return Err("The memo looks like a passphrase. Memos are public and stay on the blockchain forever, so this transaction was not signed.".into());
        }
    }

    if matches!(req.call.kind.as_str(), "validatorRegistration" | "validatorUpdate") {
        let vp = req.validator_passphrase.as_deref().ok_or("Missing validator passphrase")?;
        let same = |p: &str| p.split_whitespace().eq(vp.split_whitespace());
        if same(&req.passphrase) || req.second_passphrase.as_deref().is_some_and(same) {
            return Err("Use a separate validator passphrase, not the wallet's own passphrase".into());
        }
        let sk = bls_secret(vp)?;
        let registrant = parse_address(&from)?;
        let pop = proof_of_possession(&sk, req.chain_id, &registrant);
        req.call.bls = Some((bls_public(&sk), Some(pop)));
    }

    let (to, value, data) = call_for(&req.call)?;
    let parse = |s: &str, what: &str| s.trim().parse::<u128>().map_err(|_| format!("Invalid {what}"));
    let gas_limit = parse(&req.gas_limit, "gas limit")?;
    let tx = EvmTx {
        chain_id: req.chain_id,
        nonce: parse(&req.nonce, "nonce")? as u64,
        gas_price: parse(&req.gas_price, "gas price")?,
        gas_limit: u64::try_from(gas_limit).map_err(|_| "Invalid gas limit")?,
        to,
        value,
        data,
    };
    if tx.gas_price == 0 || tx.gas_limit < 21_000 {
        return Err("Invalid fee".into());
    }
    tx.sign(&keys, second.as_ref())
}

/// The validator's BLS public key (hex) for a validator passphrase.
pub fn validator_public_key(mnemonic: &str) -> Result<String, String> {
    Ok(hex::encode(bls_public(&bls_secret(mnemonic)?)))
}

// ---------- messages (EIP-191) ----------

fn message_hash(message: &str) -> [u8; 32] {
    let mut m = format!("\x19Ethereum Signed Message:\n{}", message.len()).into_bytes();
    m.extend_from_slice(message.as_bytes());
    keccak(&m)
}

/// 0x || r || s || v (27/28)
pub fn sign_message(keys: &KeyPair, message: &str) -> Result<String, String> {
    let (rs, recid) = keys.sign_recoverable(&message_hash(message))?;
    Ok(format!("0x{}{:02x}", hex::encode(rs), recid + 27))
}

/// True when `signature` over `message` was made by `signer` (a public key or a 0x address).
pub fn verify_message(message: &str, signer: &str, signature: &str) -> Result<bool, String> {
    let sig = hex::decode(signature.trim().trim_start_matches("0x")).map_err(|_| "Signature is not valid hex")?;
    if sig.len() != 65 {
        return Err("A Mainsail signature is 65 bytes (130 hex characters)".into());
    }
    let mut rs = [0u8; 64];
    rs.copy_from_slice(&sig[..64]);
    let v = sig[64];
    let recid = if v >= 27 { v - 27 } else { v };
    let Ok(pk) = recover(&message_hash(message), &rs, recid) else { return Ok(false) };
    let signer = signer.trim();
    if signer.starts_with("0x") || signer.starts_with("0X") {
        Ok(parse_address(signer)? == address_bytes(&pk)?)
    } else {
        let want = hex::decode(signer).map_err(|_| "Public key is not valid hex")?;
        Ok(address_bytes(&want)? == address_bytes(&pk)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const PASSPHRASE: &str = "found lobster oblige describe ready addict body brave live vacuum display salute lizard combine gift resemble race senior quality reunion proud tell adjust angle";
    const SECOND: &str = "gold favorite math anchor detect march purpose such sausage crucial reform novel connect misery update episode invite salute barely garbage exclude winner visa cruise";
    const VALIDATOR: &str = "bless organ december boring ill obvious unaware dinosaur broccoli build hamster rebuild skin airport stay entry denial agent october thought duck trouble decorate way";

    fn fixture(name: &str) -> Value {
        let path = format!("{}/tests/fixtures/mainsail/{name}.json", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn num(v: &Value) -> u128 {
        match v {
            Value::String(s) => s.parse().unwrap(),
            Value::Number(n) => n.as_u64().unwrap() as u128,
            _ => panic!("not a number"),
        }
    }

    fn tx_from(f: &Value) -> EvmTx {
        let d = &f["data"];
        EvmTx {
            chain_id: d["network"].as_u64().unwrap_or(11812),
            nonce: num(&d["nonce"]) as u64,
            gas_price: num(&d["gasPrice"]),
            gas_limit: num(&d["gasLimit"]) as u64,
            to: parse_address(d["to"].as_str().unwrap()).unwrap(),
            value: num(&d["value"]),
            data: hex::decode(d["data"].as_str().unwrap().trim_start_matches("0x")).unwrap(),
        }
    }

    #[test]
    fn signs_sdk_fixtures_byte_for_byte() {
        let keys = KeyPair::from_passphrase(PASSPHRASE).unwrap();
        for name in ["transfer", "transfer-0", "transfer-large-amount", "vote", "unvote", "multipayment", "multipayment-single", "username-registration", "username-resignation", "validator-resignation"] {
            let f = fixture(name);
            let s = tx_from(&f).sign(&keys, None).unwrap();
            assert_eq!(s.serialized, f["serialized"].as_str().unwrap(), "{name} serialized");
            assert_eq!(s.hash, f["data"]["hash"].as_str().unwrap(), "{name} hash");
            assert_eq!(s.from, f["data"]["from"].as_str().unwrap(), "{name} from");
        }
    }

    #[test]
    fn legacy_second_signature_matches_sdk() {
        let keys = KeyPair::from_passphrase(PASSPHRASE).unwrap();
        let second = KeyPair::from_passphrase(SECOND).unwrap();
        let f = fixture("transfer-legacy-second-signature");
        let s = tx_from(&f).sign(&keys, Some(&second)).unwrap();
        assert_eq!(s.serialized, f["serialized"].as_str().unwrap());
        assert_eq!(s.hash, f["data"]["hash"].as_str().unwrap());
        assert_eq!(s.legacy_second_signature.as_deref(), f["data"]["legacySecondSignature"].as_str());
    }

    #[test]
    fn calls_encode_like_the_sdk() {
        let f = fixture("vote");
        let c = call_for(&CallRequest { kind: "vote".into(), vote: Some("0xC3bBE9B1CeE1ff85Ad72b87414B0E9B7F2366763".into()), ..Default::default() }).unwrap();
        assert_eq!(hex::encode(c.2), f["data"]["data"].as_str().unwrap());
        let f = fixture("unvote");
        assert_eq!(hex::encode(call_for(&CallRequest { kind: "unvote".into(), ..Default::default() }).unwrap().2), f["data"]["data"].as_str().unwrap());
        let f = fixture("multipayment");
        let c = call_for(&CallRequest {
            kind: "multipayment".into(),
            payments: Some(vec![
                Payment { amount: "0".into(), recipient_id: "0x6F0182a0cc707b055322CcF6d4CB6a5Aff1aEb22".into() },
                Payment { amount: "0".into(), recipient_id: "0xC3bBE9B1CeE1ff85Ad72b87414B0E9B7F2366763".into() },
            ]),
            ..Default::default()
        });
        // zero amounts are refused by the wallet; check the encoder itself with the fixture's wei amounts
        assert!(c.is_err());
        let to = [parse_address("0x6F0182a0cc707b055322CcF6d4CB6a5Aff1aEb22").unwrap(), parse_address("0xC3bBE9B1CeE1ff85Ad72b87414B0E9B7F2366763").unwrap()];
        let data = encode_call("pay(address[],uint256[])", &[Arg::AddressArray(&to), Arg::UintArray(&[100_000, 200_000])]);
        assert_eq!(hex::encode(data), f["data"]["data"].as_str().unwrap());
        let f = fixture("username-registration");
        let c = call_for(&CallRequest { kind: "usernameRegistration".into(), username: Some("fixture".into()), ..Default::default() }).unwrap();
        assert_eq!(hex::encode(c.2), f["data"]["data"].as_str().unwrap());
        assert_eq!(checksum(&c.0), USERNAMES);
        for (kind, name) in [("usernameResignation", "username-resignation"), ("validatorResignation", "validator-resignation")] {
            let c = call_for(&CallRequest { kind: kind.into(), ..Default::default() }).unwrap();
            assert_eq!(hex::encode(c.2), fixture(name)["data"]["data"].as_str().unwrap(), "{kind}");
        }
    }

    #[test]
    fn validator_registration_matches_sdk() {
        let f = fixture("validator-registration");
        let chain = f["data"]["network"].as_u64().unwrap_or(11812);
        let registrant = parse_address(f["registrantAddress"].as_str().unwrap()).unwrap();
        let sk = bls_secret(f["validatorPassphrase"].as_str().unwrap()).unwrap();
        let pk = bls_public(&sk);
        let pop = proof_of_possession(&sk, chain, &registrant);
        assert_eq!(format!("0x{}", hex::encode(pk)), f["data"]["validatorPublicKey"].as_str().unwrap());
        let req = CallRequest {
            kind: "validatorRegistration".into(),
            amount: Some((num(&f["data"]["value"]) / WEI_PER_ARKTOSHI).to_string()),
            bls: Some((pk, Some(pop))),
            ..Default::default()
        };
        let (_, value, data) = call_for(&req).unwrap();
        assert_eq!(value, num(&f["data"]["value"]));
        assert_eq!(hex::encode(data), f["data"]["data"].as_str().unwrap());
        // the whole signed transaction
        let keys = KeyPair::from_passphrase(PASSPHRASE).unwrap();
        let s = tx_from(&f).sign(&keys, None).unwrap();
        assert_eq!(s.serialized, f["serialized"].as_str().unwrap());
    }

    #[test]
    fn bls_keys_match_the_node() {
        // packages/crypto-wif/test/identities.ts (wallet1) in the Mainsail node repo
        let sk = bls_secret("goddess laugh coin share picture napkin sausage surprise busy soft sting nothing drastic stove drive magic border amount symbol child swing peace book brass").unwrap();
        assert_eq!(hex::encode(sk.to_bytes()), "09dadae56492c1abd8453f393169fc2019c079b91369fe9f76d568e5964a69cf");
        assert_eq!(hex::encode(bls_public(&sk)), "84b19d74a9bcb9d9e6c59b6114499820fba555884403120149a0041b892136141cbe08d929c5a4dfa18b881467da5d68");
        // pinned proof-of-possession vector (packages/crypto-key-pair-bls12-381)
        let sk = blst::min_pk::SecretKey::from_bytes(&hex::decode("67d53f170b908cabb9eb326c3c337762d59289a8fec79f7bc9254b584b73265c").unwrap()).unwrap();
        let reg = parse_address("0x75545540230d5c3BEf023202d23CB74cFA723376").unwrap();
        assert_eq!(hex::encode(bls_public(&sk)), "a7e75af9dd4d868a41ad2f5a5b021d653e31084261724fb40ae2f1b1c31c778d3b9464502d599cf6720723ec5c68b59d");
        assert_eq!(hex::encode(proof_of_possession(&sk, 10_000, &reg)), "a892e94d8ed6d0fe8792dcb31b7c5116a7d138ad4bbbd044780a7c314e86673e783850121dc34d0edfa2a2560c2f30a402f4fa5106ff71d5c69bc3027210ef90b3d3ae0a19ffc9f554b37aca72f3bb25788c3177514d94e041441ba9d029b3ba");
        assert!(bls_secret("not a mnemonic").is_err());
        let _ = VALIDATOR;
    }

    #[test]
    fn messages_match_sdk() {
        let f = fixture("message-sign");
        let keys = KeyPair::from_passphrase(PASSPHRASE).unwrap();
        let sig = sign_message(&keys, f["message"].as_str().unwrap()).unwrap();
        assert_eq!(sig, f["signature"].as_str().unwrap());
        assert!(verify_message(f["message"].as_str().unwrap(), f["publicKey"].as_str().unwrap(), &sig).unwrap());
        let addr = address_from_public_key(&keys.public).unwrap();
        assert!(verify_message(f["message"].as_str().unwrap(), &addr, &sig).unwrap());
        assert!(!verify_message("other", &addr, &sig).unwrap());
    }

    #[test]
    fn addresses() {
        let keys = KeyPair::from_passphrase(PASSPHRASE).unwrap();
        assert_eq!(address_from_public_key(&keys.public).unwrap(), "0x1E6747BEAa5B4076a6A98D735DF8c35a70D18Bdd");
        assert!(parse_address("0x1E6747BEAa5B4076a6A98D735DF8c35a70D18Bdd").is_ok());
        assert!(parse_address("0x1e6747beaa5b4076a6a98d735df8c35a70d18bdd").is_ok());
        assert!(parse_address("0x1E6747BEAa5B4076a6A98D735DF8c35a70D18BdD").is_err()); // checksum typo
        assert!(parse_address("1E6747BEAa5B4076a6A98D735DF8c35a70D18Bdd").is_err());
        // the node's own fixture: wallet1
        let pk = hex::decode("02ffa9181f8ea9ea1ed85bed0ce53213367b5e8258b18cc745fa397ed40fa867fe").unwrap();
        assert_eq!(address_from_public_key(&pk).unwrap(), "0x4DDA5269bC0D28c15006A75C6eaFb282138c71A6");
    }

    #[test]
    fn build_checks_keys_and_refuses_reused_validator_passphrase() {
        let from = address_from_public_key(&KeyPair::from_passphrase(PASSPHRASE).unwrap().public).unwrap();
        let mk = |kind: &str, vp: Option<&str>| BuildRequest {
            chain_id: 11812,
            nonce: "0".into(),
            gas_price: "5000000000".into(),
            gas_limit: "500000".into(),
            call: CallRequest { kind: kind.into(), amount: Some("25000000000".into()), ..Default::default() },
            passphrase: PASSPHRASE.into(),
            second_passphrase: None,
            validator_passphrase: vp.map(Into::into),
            expected_address: from.clone(),
            expected_second_public_key: None,
        };
        assert!(build_and_sign(&mut mk("validatorRegistration", Some(PASSPHRASE))).is_err());
        let ok = build_and_sign(&mut mk("validatorRegistration", Some(VALIDATOR))).unwrap();
        assert_eq!(ok.to, CONSENSUS);
        assert_eq!(ok.value, "250000000000000000000");
        let mut wrong = mk("validatorRegistration", Some(VALIDATOR));
        wrong.expected_address = "0x6F0182a0cc707b055322CcF6d4CB6a5Aff1aEb22".into();
        assert!(build_and_sign(&mut wrong).is_err());
        // a second passphrase on record is required
        let mut need2 = mk("unvote", None);
        need2.expected_second_public_key = Some(KeyPair::from_passphrase(SECOND).unwrap().public_hex());
        assert!(build_and_sign(&mut need2).is_err());
        need2.second_passphrase = Some(SECOND.into());
        assert!(build_and_sign(&mut need2).unwrap().legacy_second_signature.is_some());
    }

    /// Real testnet transactions (chain 11812): rebuilding them from their published fields and
    /// signature must give their hash and their sender, i.e. the network uses this exact format.
    #[test]
    fn matches_live_testnet_transactions() {
        let path = format!("{}/tests/fixtures/mainsail/testnet-live.json", env!("CARGO_MANIFEST_DIR"));
        let txs: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for t in txs {
            let tx = EvmTx {
                chain_id: 11812,
                nonce: num(&t["nonce"]) as u64,
                gas_price: num(&t["gasPrice"]),
                gas_limit: num(&t["gas"]) as u64,
                to: parse_address(t["to"].as_str().unwrap()).unwrap(),
                value: num(&t["value"]),
                data: hex::decode(t["data"].as_str().unwrap().trim_start_matches("0x")).unwrap(),
            };
            let sig = hex::decode(t["signature"].as_str().unwrap()).unwrap();
            let mut rs = [0u8; 64];
            rs.copy_from_slice(&sig[..64]);
            let signed = tx.signed_rlp(&rs, sig[64], None);
            assert_eq!(hex::encode(keccak(&signed)), t["hash"].as_str().unwrap());
            let pk = recover(&tx.signing_hash(), &rs, sig[64]).unwrap();
            assert_eq!(hex::encode(pk), t["senderPublicKey"].as_str().unwrap());
            assert_eq!(address_from_public_key(&pk).unwrap(), t["from"].as_str().unwrap());
        }
    }

    #[test]
    fn legacy_registration_encoding() {
        let req = CallRequest { kind: "validatorRegistration".into(), amount: Some("25000000000".into()), bls: Some(([7u8; 48], None)), legacy_registration: true, ..Default::default() };
        let (_, _, data) = call_for(&req).unwrap();
        assert_eq!(hex::encode(&data[..4]), "602a9eee");
        assert_eq!(data.len(), 4 + 32 + 32 + 64);
    }

    /// The exact JSON the UI (ConfirmEvm.svelte) sends: camelCase, the call flattened in, nulls for unused keys.
    #[test]
    fn ui_request_json_deserializes_and_signs() {
        let from = address_from_public_key(&KeyPair::from_passphrase(PASSPHRASE).unwrap().public).unwrap();
        let transfer = serde_json::json!({
            "kind": "transfer", "amount": "150000000", "recipientId": "0x405b21622ab8c6d758c82e3d486aadc61c07d42a",
            "memo": "hello mainsail", "username": null,
            "chainId": 11812, "nonce": "3", "gasPrice": "5000000000", "gasLimit": "21224",
            "passphrase": PASSPHRASE, "secondPassphrase": null, "validatorPassphrase": null,
            "expectedAddress": from.to_lowercase(), "expectedSecondPublicKey": null
        });
        let mut req: BuildRequest = serde_json::from_value(transfer).unwrap();
        let tx = build_and_sign(&mut req).unwrap();
        assert_eq!(tx.value, "1500000000000000000");
        assert_eq!(tx.data, hex::encode("hello mainsail"));
        assert_eq!(tx.to, "0x405b21622ab8C6D758C82e3D486aADc61C07D42A");

        let register = serde_json::json!({
            "kind": "validatorRegistration", "amount": "25000000000", "legacyRegistration": true,
            "chainId": 11812, "nonce": "0", "gasPrice": "5000000000", "gasLimit": "500000",
            "passphrase": PASSPHRASE, "secondPassphrase": null, "validatorPassphrase": VALIDATOR,
            "expectedAddress": from, "expectedSecondPublicKey": null
        });
        let mut req: BuildRequest = serde_json::from_value(register).unwrap();
        let tx = build_and_sign(&mut req).unwrap();
        assert!(tx.data.starts_with("602a9eee"), "legacy registerValidator(bytes)");
        assert!(tx.data.contains(&validator_public_key(VALIDATOR).unwrap().trim_start_matches("0x").to_string()));
        assert_eq!(tx.value, "250000000000000000000");
        assert_eq!(tx.to, CONSENSUS);
    }
}
