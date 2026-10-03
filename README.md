# Reading DNA by eye

**Can a person learn to read raw nanopore DNA signal — and how do they compare with machine learning?**

A browser experiment. Each trial shows a real stretch of electrical current recorded as DNA passed through a
nanopore; you press **A, C, G or T** for the base in the highlighted stretch, learning only from the feedback.
At the end you're compared — on exactly the same traces — with simple models, a convolutional neural network and
Oxford Nanopore's own basecaller (Dorado), and with learners that saw exactly what you saw.

- **Session 1** (≈25–35 min): learn from right/wrong feedback; once you reach 50% (or at trial 600) the DNA switches to methylated DNA.
- **Session 2** (≈30 min): a retention test, training with the true sequence shown after each answer, a transfer test, then methylated DNA.

Needs a physical keyboard. Everything runs in your browser — nothing is uploaded; your sessions are kept in
local storage (so traces you've seen are never repeated) and can be downloaded as CSV / JSON.

## Run locally
```bash
npm install
npm run dev                       # full research version (all protocols, debug tools: add ?debug)
VITE_PUBLIC=true npm run build    # the public version (sessions 1 and 2 only) → dist/
npm test
```

## Deploy
`npm run deploy` runs the tests, builds the public version and publishes it to the `gh-pages` branch, which GitHub Pages serves.
For automatic deploys on every push instead, move `deploy/github-actions-deploy.yml` to `.github/workflows/` (needs a GitHub token with the `workflow` scope: `gh auth refresh -s workflow`) and set Settings → Pages → Source to *GitHub Actions*.

## Data
Derived from the ONT Methylation Benchmarking Datasets (MIT License; Kulkarni et al., 2024). See [DATA.md](DATA.md).
