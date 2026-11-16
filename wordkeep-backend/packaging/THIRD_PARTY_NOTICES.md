# Third-party notices

The release includes CPython, Python runtime dependencies and HanLP model resources.
Copyright notices and full license texts are distributed in `licenses/`;
`licenses/packages.json` records bundled dependency versions and license paths.
Python notices include the PyInstaller bootloader.

## wordcloud

- Source: https://github.com/amueller/word_cloud
- License: MIT
- Copyright (c) 2012 Andreas Christian Mueller.

The original copyright and full MIT notice are included in `licenses/python/wordcloud/`.
Wordkeep uses fonts selected by the user.

## HanLP model resources

- Source: https://github.com/hankcs/HanLP
- Author: Han He (hankcs) and the HanLP contributors.
- Code license: Apache-2.0.
- Model license: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.

The release includes the following resources, with download URLs and checksums
recorded in `data/model-manifest.json`:

- CLOSE_TOK_POS_NER_SRL_UDEP_SDP_CON_ELECTRA_SMALL_ZH (2022-06-26).
- ELECTRA tokenizer resources (2021-07-06).
- Character normalization table (2021-06-02).

The model weights, vocabularies and configuration are distributed in their
original form under CC BY-NC-SA 4.0. The full license accompanies the release.
Commercial distribution requires separate authorization from the rights holder.

- Upstream terms: https://github.com/hankcs/HanLP#license
- Model license: https://creativecommons.org/licenses/by-nc-sa/4.0/

## PyInstaller

The PyInstaller bootloader license exception permits distributing bundled
applications under their own license. Its copyright, license and exception are
included in the generated Python notices.
