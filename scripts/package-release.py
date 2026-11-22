from pathlib import Path
import hashlib, json, tarfile, sys

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]).resolve()
files = [root / 'package.json', root / 'package-lock.json']
for group in ['packages', 'services', 'apps']:
    files += sorted((root / group).glob('*/package.json'))
files += sorted((root / 'dist').rglob('*'))
files += sorted((root / 'migrations').glob('*.sql'))
files = [p for p in files if p.is_file()]
assert root.joinpath('dist/server.mjs').is_file()
assert root.joinpath('dist/web/index.html').is_file()
manifest = [{'path': p.relative_to(root).as_posix(), 'bytes': p.stat().st_size,
             'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]
destination.parent.mkdir(parents=True, exist_ok=True)
with tarfile.open(destination, 'w:gz') as archive:
    for p in files:
        archive.add(p, arcname=p.relative_to(root).as_posix(), recursive=False)
manifest_path = destination.with_suffix('.manifest.json')
manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf8')
print(json.dumps({'archive': str(destination), 'files': len(files),
                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}))
