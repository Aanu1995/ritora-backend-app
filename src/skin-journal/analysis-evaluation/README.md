# Skin Journal Analysis Evaluation Fixtures

This directory defines the private manual regression set for Skin Journal photo
analysis. The TypeScript fixture manifest is committed, but the photos are not:
place private `.webp` files with the matching names in a local secure fixture
folder when running model-evaluation sessions.

The set intentionally covers:

- poor lighting
- deeper skin tone in even lighting
- glare
- makeup or filter masking
- no analyzable face
- mild irritation-like signal
- severe reaction-like signal
- side-localized reaction-like signal

Do not commit identifiable user photos. Use consented, de-identified internal
fixtures only.
