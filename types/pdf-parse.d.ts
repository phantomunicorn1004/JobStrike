declare module "pdf-parse" {
  interface PDFData {
    numpages: number;
    text: string;
  }
  function pdfParse(buffer: Buffer): Promise<PDFData>;
  export default pdfParse;
}
