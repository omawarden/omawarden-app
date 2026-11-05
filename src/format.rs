//! Formatting and masking: how a secret, a card number, a date, or a size is
//! shown.
//!
//! These are pure functions with no adapter seam, and the inspector and the
//! filter projection both read through them, so a field is masked the same way
//! wherever it appears.

/// The exact shape of a masked secret in the inspector.
pub(crate) const MASK: &str = "••••••••";

/// Masks a secret with a fixed run of dots.
pub(crate) fn mask_secret(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        MASK.to_string()
    }
}

/// Masks all but the last four digits of a card number.
/// The grouping lengths for a card number, by issuer and BIN.
pub(crate) fn card_segments(digits: &str, brand: &str) -> Vec<usize> {
    let len = digits.len();
    if len <= 4 {
        return vec![len];
    }
    let brand = brand.to_lowercase();
    let brand = brand.replace([' ', '-', '_'], "");
    let is_amex_brand = brand == "amex" || brand.contains("americanexpress");
    let is_amex_bin = digits.starts_with("34") || digits.starts_with("37");
    if len == 15 && (is_amex_bin || is_amex_brand) {
        return vec![4, 6, 5];
    }
    let is_diners_brand = brand.contains("diners");
    let is_diners_bin = digits.starts_with("36")
        || digits.starts_with("38")
        || (300..=305).any(|prefix| digits.starts_with(&prefix.to_string()));
    if len == 14 && (is_diners_bin || is_diners_brand) {
        return vec![4, 6, 4];
    }
    let mut segments = Vec::new();
    let mut remaining = len;
    while remaining > 0 {
        let chunk = remaining.min(4);
        segments.push(chunk);
        remaining -= chunk;
    }
    segments
}

/// Partitions `text` according to `segments`.
pub(crate) fn partition_card(text: &str, segments: &[usize]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut parts = Vec::new();
    let mut index = 0;
    for size in segments {
        if index >= chars.len() {
            break;
        }
        let end = (index + size).min(chars.len());
        parts.push(chars[index..end].iter().collect::<String>());
        index = end;
    }
    if index < chars.len() {
        parts.push(chars[index..].iter().collect());
    }
    parts.join(" ")
}

/// Masks a card number, revealing only the last four digits.
pub(crate) fn mask_card_number_for(number: &str, brand: &str) -> String {
    let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return "•••• •••• •••• ••••".to_string();
    }
    if digits.len() <= 4 {
        return "•".repeat(digits.len());
    }
    let mask_count = digits.len() - 4;
    let last_four = &digits[digits.len() - 4..];
    let masked = format!("{}{last_four}", "•".repeat(mask_count));
    partition_card(&masked, &card_segments(&digits, brand))
}

/// Formats a revealed card number with the issuer's grouping.
pub(crate) fn format_card_number_for(number: &str, brand: &str) -> String {
    let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return String::new();
    }
    partition_card(&digits, &card_segments(&digits, brand))
}

/// Masks a card number, revealing only the last four digits.
#[cfg(test)]
pub(crate) fn mask_card_number(number: &str) -> String {
    mask_card_number_for(number, "")
}

/// Formats a card number in spaced groups of four (revealed).
#[cfg(test)]
pub(crate) fn format_card_number(number: &str) -> String {
    format_card_number_for(number, "")
}

/// Formats an expiration as `MM / YYYY`.
pub(crate) fn format_expiration(month: &str, year: &str) -> String {
    if month.is_empty() && year.is_empty() {
        return String::new();
    }
    let month = month.trim();
    let year = year.trim();
    let month = if month.len() == 1 {
        format!("0{month}")
    } else {
        month.to_string()
    };
    if year.is_empty() {
        month
    } else if month.is_empty() {
        year.to_string()
    } else {
        format!("{month} / {year}")
    }
}

/// Formats a byte size for humans.
pub(crate) fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}
