# Contributing

Issues and pull requests are welcome. Keep changes focused and describe the user-visible behavior and the checks you ran.

1. Fork the repository and create a branch.
2. Install Python dependencies and browser-test dependencies using the README.
3. Run `python -m unittest discover -s tests -v` and `npm test`.
4. Open a pull request with a concise explanation and test results.

For UI changes, check desktop and phone sizes, keyboard focus, reduced motion and the compact app view. Use fictional fixture data for screenshots. Keep live inventory, private links, certificates and browser profiles out of contributions.

Prefer standard-library Python where practical and keep the frontend build-free. Changes to proxy headers, cookies, allowed Docker API operations or network exposure need tests and a clear explanation of the trust boundary.

By contributing, you agree that your contributions may be distributed under the repository's MIT license. Report security issues privately as described in SECURITY.md.
