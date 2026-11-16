# PyInstaller configuration: installed files are already expanded.
import json
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

root = Path(SPECPATH).parent
resources = Path(os.environ.get('WORDKEEP_BUILD_RESOURCES', root / 'dist' / 'wordkeep-backend'))
model_config = next((resources / 'data' / 'hanlp' / 'mtl').glob('*/config.json'))


def class_modules(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == 'classpath' and isinstance(item, str):
                yield item.rsplit('.', 1)[0]
            else:
                yield from class_modules(item)
    elif isinstance(value, list):
        for item in value:
            yield from class_modules(item)


hidden = sorted(set(class_modules(json.loads(model_config.read_text(encoding='utf-8')))))
hidden += [
    'transformers.models.electra.modeling_electra',
    'transformers.models.electra.configuration_electra',
    'transformers.models.bert.tokenization_bert',
    'uvicorn.loops.asyncio',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.lifespan.off',
]
a = Analysis(
    [str(root / 'packaging' / 'backend_entry.py')],
    pathex=[],
    binaries=[],
    datas=collect_data_files('hanlp') + copy_metadata('hanlp', recursive=True),
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={'matplotlib': {'backends': ['Agg']}},
    excludes=[
        'tensorflow', 'tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
        # Exclude development tools, including pytest's internal and legacy imports.
        'pytest', '_pytest', 'py', 'mypy', 'ruff', 'pre_commit',
    ],
    noarchive=True,
    optimize=0,
    # Keep source needed by inspect/JIT; build.py precompiles its __pycache__.
    module_collection_mode={
        'hanlp': 'py', 'hanlp_common': 'py',
        'torch': 'py', 'transformers': 'py',
    },
)
# Fonts are supplied by the user; wordcloud's stopwords remain import-time data.
a.datas = [
    entry for entry in a.datas
    if Path(entry[0]).as_posix() != 'wordcloud/DroidSansMono.ttf'
]

# The bootloader uses an empty PYZ header; modules are external pyc/py files.
assert not a.pure, 'Runtime modules must not be stored in a compressed PYZ'
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='wordkeep-backend',
    console=os.name != 'nt',
    contents_directory='_internal',
    cdict={},  # Store bootstrap scripts uncompressed.
    upx=False,
    strip=False,
    codesign_identity=os.environ.get('WORDKEEP_CODESIGN_IDENTITY'),
    entitlements_file=str(root / 'packaging' / 'backend-entitlements.plist') if os.name != 'nt' else None,
)
collection = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='wordkeep-backend')
