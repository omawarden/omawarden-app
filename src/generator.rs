//! Generated secrets: passwords and passphrases, with their strength labels.
//!
//! [`GeneratorEngine`] is the seam. There is no mock fork here: a generated
//! secret is the same secret in either run mode, so both adapters call the
//! same functions. The seam still exists so the bridge method stays one line
//! and the range checks live next to the generation they guard.

use omawarden::generator::{
    PassphraseOptions, PasswordOptions, generate_passphrase, generate_password,
};

use crate::{
    ERR_PASSPHRASE_WORDS, ERR_PASSWORD_LENGTH, GeneratedSecretView, PassphraseGenInput,
    PasswordGenInput,
};

/// The generation capabilities the bridge exposes.
pub(crate) trait GeneratorEngine {
    /// Generates a password, validating the requested length.
    fn password(&self, input: PasswordGenInput) -> GeneratedSecretView;

    /// Generates a passphrase, validating the requested word count.
    fn passphrase(&self, input: PassphraseGenInput) -> GeneratedSecretView;
}

/// The real adapter: the engine's generator.
pub(crate) struct InProcess;

impl GeneratorEngine for InProcess {
    fn password(&self, input: PasswordGenInput) -> GeneratedSecretView {
        generate_password_view(input)
    }

    fn passphrase(&self, input: PassphraseGenInput) -> GeneratedSecretView {
        generate_passphrase_view(input)
    }
}

/// The mock adapter: the same generator, since a secret has no mock state.
pub(crate) struct Mock;

impl GeneratorEngine for Mock {
    fn password(&self, input: PasswordGenInput) -> GeneratedSecretView {
        generate_password_view(input)
    }

    fn passphrase(&self, input: PassphraseGenInput) -> GeneratedSecretView {
        generate_passphrase_view(input)
    }
}

/// Generates a password with strict range validation and its entropy.
fn generate_password_view(input: PasswordGenInput) -> GeneratedSecretView {
    if !(5..=128).contains(&input.length) {
        return GeneratedSecretView {
            ok: false,
            value: String::new(),
            entropy: 0.0,
            strength: "Weak".to_string(),
            error: Some(ERR_PASSWORD_LENGTH.to_string()),
        };
    }
    let options = PasswordOptions {
        length: input.length as usize,
        uppercase: input.uppercase,
        lowercase: input.lowercase,
        numbers: input.numbers,
        special: input.special,
        avoid_ambiguous: input.avoid_ambiguous,
        min_numbers: input.min_numbers as usize,
        min_special: input.min_special as usize,
    };
    match generate_password(&options) {
        Ok(secret) => GeneratedSecretView {
            ok: true,
            value: secret.value.clone(),
            entropy: secret.entropy,
            strength: strength_label(secret.entropy).to_string(),
            error: None,
        },
        Err(error) => GeneratedSecretView {
            ok: false,
            value: String::new(),
            entropy: 0.0,
            strength: "Weak".to_string(),
            error: Some(error),
        },
    }
}

/// Generates an EFF Diceware passphrase with strict word count validation.
fn generate_passphrase_view(input: PassphraseGenInput) -> GeneratedSecretView {
    if !(3..=20).contains(&input.words) {
        return GeneratedSecretView {
            ok: false,
            value: String::new(),
            entropy: 0.0,
            strength: "Weak".to_string(),
            error: Some(ERR_PASSPHRASE_WORDS.to_string()),
        };
    }
    let separator = if input.separator.is_empty() {
        "-".to_string()
    } else {
        input.separator.clone()
    };
    let options = PassphraseOptions {
        words: input.words as usize,
        separator,
        capitalize: input.capitalize,
    };
    match generate_passphrase(&options) {
        Ok(secret) => GeneratedSecretView {
            ok: true,
            value: secret.value.clone(),
            entropy: secret.entropy,
            strength: strength_label(secret.entropy).to_string(),
            error: None,
        },
        Err(error) => GeneratedSecretView {
            ok: false,
            value: String::new(),
            entropy: 0.0,
            strength: "Weak".to_string(),
            error: Some(error),
        },
    }
}

/// The strength label for an entropy in bits.
pub(crate) fn strength_label(entropy: f64) -> &'static str {
    if entropy < 40.0 {
        "Weak"
    } else if entropy < 60.0 {
        "Fair"
    } else if entropy < 80.0 {
        "Good"
    } else if entropy < 100.0 {
        "Strong"
    } else {
        "Very Strong"
    }
}
