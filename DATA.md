# Data sources and attribution

`public/data/` contains signal windows derived from the **ONT Methylation Benchmarking Datasets**
(Registry of Open Data on AWS, `ont-basemod-benchmark-data`, https://registry.opendata.aws/ont_basemod_data),
released under the **MIT License**. Accessed October 2026.

> Kulkarni et al. *Comprehensive benchmarking of tools for nanopore-based detection of DNA methylation.*
> bioRxiv (2024). https://doi.org/10.1101/2024.11.09.622763

Samples used: *E. coli* dam⁻/dcm⁻ (`Ecoli_DM_5kHz`, unmethylated) and the same DNA treated with M.SssI
(`Ecoli_DM_MSssI_5kHz`, every CpG methylated); R10.4.1 flow cells, 5 kHz. 950 reads were extracted, basecalled
with Oxford Nanopore's Dorado 2.1.2 (fast / hac / sup v5.2.0 models, plus the 5mCG model), and aligned to
*E. coli* K-12 MG1655 (NC_000913.3). Each window is 161 samples of normalised current centred on one base; the label
is the reference base. The stored per-window predictions of the Dorado models and of the simple models / CNN are
outputs computed for this project.
