# HF Model Size

Chrome extension (Manifest V3) that shows total repo file sizes on Hugging Face.

- **`/models` listing pages** — every model card gets a size badge at the end of its meta row (e.g. quantization searches like `?other=base_model:quantized:moonshotai/Kimi-K3`)
- **Model pages** (`/{author}/{name}`) — a size pill is added to the tag row under the model name, linking to the Files tab

The size is the same number shown on the repo's `/tree/main` page (sum of all files in the current revision, e.g. `1.56 TB`).

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder

## How it works

- Sizes are computed from `/api/models/{id}/tree/main?recursive=true` (sum of file sizes, following pagination) — no permissions required, requests use your existing HF session
- Results are cached in `localStorage` for 12 hours, so repeat visits are instant
- Works with HF's client-side filtering/pagination via a `MutationObserver`
- Gated/private repos work if your account has access; repos with no files show no badge
