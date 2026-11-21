pub mod crypto;
pub mod tx;

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;
use zeroize::Zeroize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DerivedWallet {
    address: String,
    public_key: String,
}

#[tauri::command]
fn derive_wallet(mut passphrase: String, network: u8) -> Result<DerivedWallet, String> {
    let kp = crypto::KeyPair::from_passphrase(passphrase.trim());
    passphrase.zeroize();
    let kp = kp?;
    Ok(DerivedWallet {
        address: crypto::address_from_public_key(&kp.public, network),
        public_key: kp.public_hex(),
    })
}

#[tauri::command]
fn validate_address(address: String, network: u8) -> bool {
    crypto::decode_address(&address, network).is_ok()
}

#[tauri::command]
fn generate_mnemonic(words: usize) -> Result<String, String> {
    crypto::generate_mnemonic(words)
}

#[derive(Serialize)]
struct BuiltTx {
    tx: tx::TxData,
    size: usize,
}

#[tauri::command]
fn build_transaction(request: tx::BuildRequest) -> Result<BuiltTx, String> {
    let t = tx::build_and_sign(&request)?;
    let size = tx::serialize(&t, true, true)?.len();
    Ok(BuiltTx { tx: t, size })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedMessage {
    message: String,
    public_key: String,
    signature: String,
}

#[tauri::command]
fn sign_message(message: String, mut passphrase: String, expected_address: String, network: u8) -> Result<SignedMessage, String> {
    let kp = crypto::KeyPair::from_passphrase(passphrase.trim());
    passphrase.zeroize();
    let kp = kp?;
    if crypto::address_from_public_key(&kp.public, network) != expected_address {
        return Err("This passphrase does not belong to this wallet".into());
    }
    let sig = kp.sign_ecdsa(&crypto::sha256(message.as_bytes()));
    Ok(SignedMessage { message, public_key: kp.public_hex(), signature: hex::encode(sig) })
}

#[tauri::command]
fn verify_message(message: String, public_key: String, signature: String) -> Result<bool, String> {
    let pk = hex::decode(public_key.trim()).map_err(|_| "Public key is not valid hex")?;
    let sig = hex::decode(signature.trim()).map_err(|_| "Signature is not valid hex")?;
    Ok(crypto::verify_any(&crypto::sha256(message.as_bytes()), &sig, &pk))
}

#[tauri::command]
fn address_from_public_key(public_key: String, network: u8) -> Result<String, String> {
    let pk = hex::decode(public_key.trim()).map_err(|_| "Public key is not valid hex")?;
    k256::PublicKey::from_sec1_bytes(&pk).map_err(|_| "Invalid public key")?;
    Ok(crypto::address_from_public_key(&pk, network))
}

// ---------- HTTP (done in Rust to avoid CORS issues with custom nodes) ----------

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("ark-wallet-desktop/0.1")
        .build()
        .map_err(|e| e.to_string())
}

fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Ok(())
    } else {
        Err("Only http(s) URLs are allowed".into())
    }
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    body: Value,
}

async fn finish(resp: reqwest::Response) -> Result<HttpResponse, String> {
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or(Value::String(text));
    Ok(HttpResponse { status, body })
}

#[tauri::command]
async fn http_get(url: String) -> Result<HttpResponse, String> {
    check_url(&url)?;
    let resp = client()?.get(&url).send().await.map_err(|e| format!("Network error: {e}"))?;
    finish(resp).await
}

#[tauri::command]
async fn http_post(url: String, body: Value) -> Result<HttpResponse, String> {
    check_url(&url)?;
    let resp = client()?.post(&url).json(&body).send().await.map_err(|e| format!("Network error: {e}"))?;
    finish(resp).await
}

// ---------- Local state (wallet collection + settings; never secrets) ----------

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<Value, String> {
    let p = state_path(&app)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(_) => Ok(Value::Null),
    }
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, state: Value) -> Result<(), String> {
    let p = state_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// macOS: the trackpad "swipe between pages" gesture (three fingers, or two-or-three) arrives as an
/// NSEvent swipe that the webview never sees. Watch for it and tell the UI to go back or forward.
#[cfg(target_os = "macos")]
fn install_swipe_back(app: &tauri::AppHandle) {
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;
    use tauri::Emitter;

    let handle = app.clone();
    let block = block2::RcBlock::new(move |ev: NonNull<NSEvent>| -> *mut NSEvent {
        // AppKit convention (as in Safari): deltaX > 0 is the "back" swipe, deltaX < 0 is "forward"
        let dx = unsafe { ev.as_ref().deltaX() };
        if dx > 0.0 {
            let _ = handle.emit("nav-back", ());
        } else if dx < 0.0 {
            let _ = handle.emit("nav-forward", ());
        }
        ev.as_ptr()
    });
    // the monitor must live for the whole app run
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::Swipe, &block) };
    std::mem::forget(monitor);
    std::mem::forget(block);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            install_swipe_back(_app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            derive_wallet,
            validate_address,
            generate_mnemonic,
            build_transaction,
            sign_message,
            verify_message,
            address_from_public_key,
            http_get,
            http_post,
            load_state,
            save_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running ARK Wallet");
}
