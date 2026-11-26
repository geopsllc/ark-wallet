//! ARK Core v3 key handling, addresses and signatures.
//!
//! - Private key = sha256(passphrase)  (ARK "passphrase" wallets, incl. BIP39 mnemonics used as passphrase)
//! - Address     = base58check(pubKeyHash || ripemd160(compressed public key))
//! - Signatures  = ARK "Schnorr" (bcrypto legacy / pre-BIP340 variant, 64 bytes) or DER ECDSA.

use k256::elliptic_curve::ops::Reduce;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::elliptic_curve::PrimeField;
use k256::{AffinePoint, FieldBytes, FieldElement, ProjectivePoint, Scalar, U256};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

pub struct KeyPair {
    secret: Zeroizing<[u8; 32]>,
    pub public: [u8; 33],
}

impl KeyPair {
    pub fn from_passphrase(passphrase: &str) -> Result<Self, String> {
        let secret = Zeroizing::new(sha256(passphrase.as_bytes()));
        let sk = k256::SecretKey::from_slice(secret.as_ref()).map_err(|_| "invalid passphrase key")?;
        let public: [u8; 33] = sk
            .public_key()
            .to_encoded_point(true)
            .as_bytes()
            .try_into()
            .map_err(|_| "bad public key")?;
        Ok(Self { secret, public })
    }

    pub fn public_hex(&self) -> String {
        hex::encode(self.public)
    }

    fn scalar(&self) -> Scalar {
        let fb: FieldBytes = (*self.secret).into();
        Option::from(Scalar::from_repr(fb)).expect("valid secret scalar")
    }

    /// ARK Schnorr (legacy bcrypto variant). `msg` is a 32-byte hash.
    pub fn sign_schnorr(&self, msg: &[u8; 32]) -> [u8; 64] {
        // the private scalar and the nonce are both secret (either one plus a signature reveals the key)
        let d = Zeroizing::new(self.scalar());
        let mut nonce_input = Zeroizing::new([0u8; 64]);
        nonce_input[..32].copy_from_slice(self.secret.as_ref());
        nonce_input[32..].copy_from_slice(msg);
        let mut k = Zeroizing::new(<Scalar as Reduce<U256>>::reduce_bytes(&sha256(nonce_input.as_ref()).into()));
        let r_point = (ProjectivePoint::GENERATOR * *k).to_affine();
        let (rx, ry) = xy(&r_point).expect("non-identity nonce point");
        if !is_square(&ry) {
            *k = -*k;
        }
        let e = challenge(&rx, &self.public, msg);
        let s = *k + e * *d;
        let mut sig = [0u8; 64];
        sig[..32].copy_from_slice(&rx);
        sig[32..].copy_from_slice(&s.to_bytes());
        sig
    }

    /// Deterministic (RFC6979) low-S ECDSA, DER encoded.
    pub fn sign_ecdsa(&self, msg: &[u8; 32]) -> Vec<u8> {
        use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
        let sk = SigningKey::from_slice(self.secret.as_ref()).expect("valid key");
        let sig: Signature = sk.sign_prehash(msg).expect("sign");
        let sig = sig.normalize_s().unwrap_or(sig);
        sig.to_der().as_bytes().to_vec()
    }

    /// Deterministic (RFC6979) low-S ECDSA with recovery id, as Ethereum/Mainsail use it:
    /// returns (r || s, recovery id 0/1).
    pub fn sign_recoverable(&self, msg: &[u8; 32]) -> Result<([u8; 64], u8), String> {
        use k256::ecdsa::SigningKey;
        let sk = SigningKey::from_slice(self.secret.as_ref()).map_err(|_| "invalid key")?;
        let (sig, rid) = sk.sign_prehash_recoverable(msg).map_err(|_| "signing failed")?;
        let mut rs = [0u8; 64];
        rs.copy_from_slice(&sig.to_bytes());
        Ok((rs, rid.to_byte()))
    }
}

fn xy(p: &AffinePoint) -> Option<([u8; 32], [u8; 32])> {
    let ep = p.to_encoded_point(false);
    let x: [u8; 32] = (*ep.x()?).into();
    let y: [u8; 32] = (*ep.y()?).into();
    Some((x, y))
}

fn is_square(y: &[u8; 32]) -> bool {
    let fe: Option<FieldElement> = FieldElement::from_bytes(&(*y).into()).into();
    match fe {
        Some(fe) => bool::from(fe.sqrt().is_some()),
        None => false,
    }
}

fn challenge(rx: &[u8; 32], pubkey: &[u8; 33], msg: &[u8; 32]) -> Scalar {
    let mut h = Sha256::new();
    h.update(rx);
    h.update(pubkey);
    h.update(msg);
    <Scalar as Reduce<U256>>::reduce_bytes(&h.finalize())
}

fn parse_pubkey(pubkey: &[u8]) -> Option<(ProjectivePoint, [u8; 33])> {
    let pk = k256::PublicKey::from_sec1_bytes(pubkey).ok()?;
    let compressed: [u8; 33] = pk.to_encoded_point(true).as_bytes().try_into().ok()?;
    Some((pk.to_projective(), compressed))
}

pub fn verify_schnorr(msg: &[u8; 32], sig: &[u8], pubkey: &[u8]) -> bool {
    if sig.len() != 64 {
        return false;
    }
    let Some((p, compressed)) = parse_pubkey(pubkey) else { return false };
    let rx: [u8; 32] = sig[..32].try_into().unwrap();
    let s_bytes: [u8; 32] = sig[32..].try_into().unwrap();
    // r must be a valid field element, s a valid scalar
    if bool::from(FieldElement::from_bytes(&rx.into()).is_none()) {
        return false;
    }
    let Some(s) = Option::<Scalar>::from(Scalar::from_repr(s_bytes.into())) else { return false };
    let e = challenge(&rx, &compressed, msg);
    let r = (ProjectivePoint::GENERATOR * s - p * e).to_affine();
    match xy(&r) {
        Some((x, y)) => x == rx && is_square(&y),
        None => false,
    }
}

pub fn verify_ecdsa(msg: &[u8; 32], der: &[u8], pubkey: &[u8]) -> bool {
    use k256::ecdsa::{signature::hazmat::PrehashVerifier, Signature, VerifyingKey};
    let Ok(vk) = VerifyingKey::from_sec1_bytes(pubkey) else { return false };
    let Ok(sig) = Signature::from_der(der) else { return false };
    // Core accepts high-S? Be lenient on verify: normalize first.
    let sig = sig.normalize_s().unwrap_or(sig);
    vk.verify_prehash(msg, &sig).is_ok()
}

/// Verify either a 64-byte Schnorr or a DER ECDSA signature (ARK picks by length).
pub fn verify_any(msg: &[u8; 32], sig: &[u8], pubkey: &[u8]) -> bool {
    if sig.len() == 64 {
        verify_schnorr(msg, sig, pubkey)
    } else {
        verify_ecdsa(msg, sig, pubkey)
    }
}

pub fn address_from_public_key(pubkey: &[u8], pub_key_hash: u8) -> String {
    let mut payload = Vec::with_capacity(21);
    payload.push(pub_key_hash);
    payload.extend_from_slice(&Ripemd160::digest(pubkey));
    bs58::encode(payload).with_check().into_string()
}

/// Decode an address into its 21 raw bytes (version + hash160), checking the network byte.
pub fn decode_address(address: &str, pub_key_hash: u8) -> Result<[u8; 21], String> {
    let raw = bs58::decode(address.trim())
        .with_check(None)
        .into_vec()
        .map_err(|_| "Invalid address".to_string())?;
    // errors never echo the input: if a passphrase was pasted into an address field by mistake,
    // it must not end up in an error message on screen
    let raw: [u8; 21] = raw.try_into().map_err(|_| "Invalid address length".to_string())?;
    if raw[0] != pub_key_hash {
        return Err("The address belongs to a different network".into());
    }
    Ok(raw)
}

/// True when `text` is (or contains, as its whole content) a secret: a valid BIP39 mnemonic, or
/// the passphrase of one of `public_keys`. Used to stop a passphrase being published by accident,
/// e.g. pasted into a transaction memo or a message to sign, both of which become public.
pub fn looks_like_secret(text: &str, public_keys: &[&[u8]]) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    let words = Zeroizing::new(t.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase());
    if matches!(words.split(' ').count(), 12 | 15 | 18 | 21 | 24)
        && bip39::Mnemonic::parse_in_normalized(bip39::Language::English, &words).is_ok()
    {
        return true;
    }
    match KeyPair::from_passphrase(t) {
        Ok(kp) => public_keys.iter().any(|pk| *pk == kp.public.as_slice()),
        Err(_) => false,
    }
}

pub fn generate_mnemonic(words: usize) -> Result<String, String> {
    let m = bip39::Mnemonic::generate(words).map_err(|e| e.to_string())?;
    Ok(m.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_from_known_pubkey() {
        let pk = hex::decode("020431436cf94f3c6a6ba566fe9e42678db8486590c732ca6c3803a10a86f50b92").unwrap();
        assert_eq!(address_from_public_key(&pk, 23), "AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj");
        assert!(decode_address("AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj", 23).is_ok());
        assert!(decode_address("AKdr5d9AMEnsKYxpDcoHdyyjSCKVx3r9Nj", 30).is_err());
    }

    #[test]
    fn passphrase_this_is_a_top_secret_passphrase() {
        // Canonical ARK test fixture
        let kp = KeyPair::from_passphrase("this is a top secret passphrase").unwrap();
        assert_eq!(kp.public_hex(), "034151a3ec46b5670a682b0a63394f863587d1bc97483b1b6c70eb58e7f0aed192");
        assert_eq!(address_from_public_key(&kp.public, 30), "D61mfSggzbvQgTUe6JhYKH2doHaqJ3Dyib");
    }

    #[test]
    fn detects_secrets() {
        let kp = KeyPair::from_passphrase("my own passphrase").unwrap();
        let mine: &[&[u8]] = &[&kp.public];
        assert!(looks_like_secret("  my own passphrase ", mine));
        assert!(!looks_like_secret("rent for march", mine));
        assert!(!looks_like_secret("", mine));
        // any valid BIP39 mnemonic, whoever it belongs to, any spacing or case
        let m = generate_mnemonic(12).unwrap();
        assert!(looks_like_secret(&m.to_uppercase().replace(' ', "   "), &[]));
        assert!(looks_like_secret(&generate_mnemonic(24).unwrap(), &[]));
        // 12 dictionary words with a bad checksum are just words
        assert!(!looks_like_secret("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon", &[]));
    }

    #[test]
    fn schnorr_and_ecdsa_roundtrip() {
        let kp = KeyPair::from_passphrase("roundtrip").unwrap();
        let msg = sha256(b"hello");
        let s = kp.sign_schnorr(&msg);
        assert!(verify_schnorr(&msg, &s, &kp.public));
        let mut bad = s;
        bad[40] ^= 1;
        assert!(!verify_schnorr(&msg, &bad, &kp.public));
        let e = kp.sign_ecdsa(&msg);
        assert!(verify_ecdsa(&msg, &e, &kp.public));
        assert!(verify_any(&msg, &e, &kp.public));
    }
}

/// EIP-55 mixed-case checksum check for an Ethereum-style (Polygon) address.
pub fn evm_address_check(address: &str) -> &'static str {
    use sha3::{Digest, Keccak256};
    let Some(hex_part) = address.strip_prefix("0x") else { return "invalid" };
    if hex_part.len() != 40 || !hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
        return "invalid";
    }
    let has_upper = hex_part.bytes().any(|b| b.is_ascii_uppercase());
    let has_lower = hex_part.bytes().any(|b| b.is_ascii_lowercase());
    if !(has_upper && has_lower) {
        return "unchecked";
    }
    let lower = hex_part.to_ascii_lowercase();
    let hash = Keccak256::digest(lower.as_bytes());
    for (i, c) in hex_part.chars().enumerate() {
        if c.is_ascii_alphabetic() {
            let nibble = (hash[i / 2] >> if i % 2 == 0 { 4 } else { 0 }) & 0x0f;
            if (nibble >= 8) != c.is_ascii_uppercase() {
                return "bad-checksum";
            }
        }
    }
    "ok"
}

#[cfg(test)]
mod evm_tests {
    use super::evm_address_check;

    #[test]
    fn eip55() {
        // examples from the EIP-55 spec
        for a in [
            "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
            "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
            "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
            "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
        ] {
            assert_eq!(evm_address_check(a), "ok", "{a}");
        }
        assert_eq!(evm_address_check("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"), "bad-checksum");
        assert_eq!(evm_address_check("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "unchecked");
        assert_eq!(evm_address_check("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae"), "invalid");
        assert_eq!(evm_address_check("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), "invalid");
    }
}
