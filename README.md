# RemoteWorkSheet

## Windows: build error with path containing `#`

If you see:

```text
TypeError [ERR_INVALID_ARG_VALUE]: The argument 'path' must be a string ... without null bytes.
Received 'C:\\\x00#GitHub_proj\\...'
```

your project path contains `#` (e.g. `C:\#GitHub_proj\remote-work-helper`). Tailwind/PostCSS on Windows can then produce invalid paths and the build fails.

**Fix:** Move the repo to a path **without** `#`, for example:

- `C:\GitHub_proj\remote-work-helper` (rename the folder from `#GitHub_proj` to `GitHub_proj`), or  
- `C:\dev\remote-work-helper`

Then run `npm run build` again from the new location.
