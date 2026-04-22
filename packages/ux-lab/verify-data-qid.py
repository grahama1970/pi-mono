import os
import re
import sys

# Strict 3-part QID pattern: component:element:qualifier
QID_PATTERN = re.compile(r'data-qid=["\']([^"\']+)["\']')
STRICT_3_PART = re.compile(r'^[^:]+:[^:]+:[^:]+$')

def verify_file(filepath):
    errors = []
    with open(filepath, 'r') as f:
        content = f.read()
        qids = QID_PATTERN.findall(content)
        for qid in qids:
            if not STRICT_3_PART.match(qid):
                # Allow dynamic QIDs if they are clearly template strings in the code
                # but for static ones we want them 3-part
                if '$' not in qid and '{' not in qid:
                    errors.append(f"Invalid QID format: '{qid}' in {filepath}")
    return errors

def main():
    target_files = [
        'src/components/UxLabShell.tsx',
        'src/components/sparta/explorer/SpartaExplorer.tsx',
        'src/components/sparta/explorer/ChatTab.tsx',
        'src/components/sparta/shared/ThreatMatrix.tsx'
    ]
    
    all_errors = []
    for f in target_files:
        path = os.path.join(os.getcwd(), f)
        if os.path.exists(path):
            all_errors.extend(verify_file(path))
        else:
            print(f"Warning: File not found {path}")

    if all_errors:
        print("\n".join(all_errors))
        sys.exit(1)
    else:
        print("All QIDs compliant with strict 3-part naming.")
        sys.exit(0)

if __name__ == '__main__':
    main()
