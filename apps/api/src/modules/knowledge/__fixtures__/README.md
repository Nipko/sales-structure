# Synthetic file extraction fixtures

These small, generated QA documents contain fictional reception codes. They have
no personal data, external links, macros or commercial offers.

- `synthetic-receipt.pdf`: one page of digital text generated with ReportLab.
  SHA256 `2cbf9d0a7760eb7e4d73e63afc140c0749c36728c5a6e52cb22d231de1635525`.
  An independent pypdf reader extracted all four lines. The original base64 upload
  failed in the product's bundled PDF.js parser when passed a pooled Buffer.
- `synthetic-receipt.docx`: minimal OOXML ZIP with three paragraphs, no external
  relationships. SHA256 `0b71c449cea18bf033ba30b3d5279bcbcc6114e550a31becce4de6f65cc7652c`.

The tests use the actual installed pdf-parse and Mammoth parsers. No OCR, broad
document compatibility or business-answer correctness is inferred from them.
