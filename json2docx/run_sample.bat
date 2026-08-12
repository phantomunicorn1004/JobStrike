@echo off
REM Generate DOCX only from sample_resume_JSON.txt (one run)
python main.py --template Andrew --json-file sample_resume_JSON.txt --output-mode docx --once
exit /b %ERRORLEVEL%
