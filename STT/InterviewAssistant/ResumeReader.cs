using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace InterviewAssistant;

/// <summary>Extracts plain text from a resume file (.pdf, .docx, .txt, .md) for the call prompt.</summary>
public static partial class ResumeReader
{
    public static readonly string[] SupportedExtensions = [".pdf", ".docx", ".txt", ".md"];

    public const string FileDialogFilter =
        "Resumes (*.pdf;*.docx;*.txt;*.md)|*.pdf;*.docx;*.txt;*.md|All files (*.*)|*.*";

    public static bool IsSupported(string path) =>
        SupportedExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);

    /// <exception cref="InvalidDataException">The file cannot be read as a resume.</exception>
    public static string ReadText(string path)
    {
        string text = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".pdf" => ReadPdf(path),
            ".docx" => ReadDocx(path),
            ".doc" => throw new InvalidDataException(
                "Old .doc files are not supported. Save the resume as .docx or .pdf in Word and load that."),
            _ => File.ReadAllText(path),
        };
        text = Tidy(text);
        if (text.Length == 0)
        {
            throw new InvalidDataException(
                "No text found in this file. If it is a scanned PDF (an image of the resume), export it from Word or Google Docs as a text PDF or .docx instead.");
        }
        return text;
    }

    static string ReadPdf(string path)
    {
        try
        {
            using var document = PdfDocument.Open(path);
            var sb = new StringBuilder();
            foreach (var page in document.GetPages())
            {
                sb.AppendLine(ContentOrderTextExtractor.GetText(page));
                sb.AppendLine();
            }
            return sb.ToString();
        }
        catch (Exception ex) when (ex is not (IOException or UnauthorizedAccessException))
        {
            throw new InvalidDataException($"Could not read the PDF: {ex.Message}", ex);
        }
    }

    static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    /// <summary>
    /// A .docx is a zip whose word/document.xml holds the text: w:p paragraphs made of w:t runs,
    /// with w:tab and w:br for tabs and line breaks. List items get a bullet.
    /// </summary>
    static string ReadDocx(string path)
    {
        XDocument xml;
        try
        {
            using var zip = ZipFile.OpenRead(path);
            var entry = zip.GetEntry("word/document.xml")
                ?? throw new InvalidDataException("This .docx has no document body.");
            using var stream = entry.Open();
            xml = XDocument.Load(stream);
        }
        catch (Exception ex) when (ex is InvalidDataException or System.Xml.XmlException)
        {
            throw new InvalidDataException($"Could not read the Word file: {ex.Message}", ex);
        }

        var sb = new StringBuilder();
        // Word stores every text box twice: the real one and a copy for old Word versions
        // (mc:Fallback). Only the first is read, or text-box content would appear twice.
        XNamespace mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
        foreach (var paragraph in xml.Descendants(W + "p").Where(p => !p.Ancestors(mc + "Fallback").Any()))
        {
            var line = new StringBuilder();
            if (paragraph.Element(W + "pPr")?.Element(W + "numPr") != null)
            {
                line.Append("• ");
            }
            foreach (var node in paragraph.Descendants())
            {
                // Text boxes nest paragraphs inside paragraphs; each is written once, on its own.
                if (node.Ancestors(W + "p").FirstOrDefault() != paragraph)
                {
                    continue;
                }
                if (node.Name == W + "t")
                {
                    line.Append(node.Value);
                }
                else if (node.Name == W + "tab")
                {
                    line.Append('\t');
                }
                else if (node.Name == W + "br" || node.Name == W + "cr")
                {
                    line.Append('\n');
                }
            }
            sb.AppendLine(line.ToString());
        }
        return sb.ToString();
    }

    static string Tidy(string text)
    {
        text = text.Replace("\r\n", "\n").Replace('\r', '\n').Replace(' ', ' ');
        text = TrailingSpacePattern().Replace(text, "\n");
        text = BlankLinesPattern().Replace(text, "\n\n");
        return text.Trim();
    }

    [GeneratedRegex(@"[ \t]+\n")]
    private static partial Regex TrailingSpacePattern();

    [GeneratedRegex(@"\n{3,}")]
    private static partial Regex BlankLinesPattern();
}
