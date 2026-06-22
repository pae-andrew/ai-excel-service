"""Runnable checks for sandbox + multi-sheet I/O. Run: python test_sandbox.py"""
import pandas as pd
import sandbox
import files

sheets = {"Data": pd.DataFrame({"a": [1, 1, 2], "email": ["x@y.z", "", "p@q.r"]})}

# 1. Inspection: print works, data unchanged.
out, stdout, err = sandbox.run(sheets, "print(len(df))")
assert err is None, err
assert stdout.strip() == "3"
assert len(out["Data"]) == 3

# 2. Mutation via df persists back to its sheet.
out, _, err = sandbox.run(sheets, "df = df[df['email'] != '']")
assert err is None, err
assert len(out["Data"]) == 2, out

# 3. Adding a new sheet via the sheets dict.
out, _, err = sandbox.run(sheets, "sheets['Counts'] = df.groupby('a').size().reset_index(name='n')")
assert err is None, err
assert "Counts" in out, list(out)

# 4. Blocked import -> reported, not executed.
_, _, err = sandbox.run(sheets, "import os; os.system('echo pwned')")
assert err and "blocked" in err, f"os should be blocked, got: {err!r}"

# 5. open() removed from builtins.
_, _, err = sandbox.run(sheets, "open('/etc/passwd')")
assert err and "NameError" in err, f"open should be unavailable, got: {err!r}"

# 6. Multi-sheet xlsx round-trip.
two = {"S1": pd.DataFrame({"x": [1, 2]}), "S2": pd.DataFrame({"y": [3]})}
back = files.read_to_sheets(files.sheets_to_xlsx_bytes(two), "r.xlsx")
assert set(back) == {"S1", "S2"}, list(back)
assert len(back["S1"]) == 2 and len(back["S2"]) == 1

print("OK: sandbox + multi-sheet self-check passed")
