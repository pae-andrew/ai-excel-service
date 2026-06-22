"""Runnable check for the security-critical sandbox. Run: python test_sandbox.py"""
import pandas as pd
import sandbox

df = pd.DataFrame({"a": [1, 1, 2], "email": ["x@y.z", "", "p@q.r"]})

# 1. Inspection: print works, df unchanged.
out_df, stdout, err = sandbox.run(df, "print(len(df))")
assert err is None, err
assert stdout.strip() == "3"
assert len(out_df) == 3

# 2. Mutation persists via reassigning df.
out_df, _, err = sandbox.run(df, "df = df[df['email'] != '']")
assert err is None, err
assert len(out_df) == 2, out_df

# 3. Blocked import -> reported as error, not executed.
_, _, err = sandbox.run(df, "import os; os.system('echo pwned')")
assert err and "blocked" in err, f"os import should be blocked, got: {err!r}"

# 4. open() removed from builtins.
_, _, err = sandbox.run(df, "open('/etc/passwd')")
assert err and "NameError" in err, f"open should be unavailable, got: {err!r}"

print("OK: sandbox self-check passed")
