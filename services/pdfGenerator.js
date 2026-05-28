import fs from "fs/promises";
import path from "path";
import handlebars from "handlebars";
import html_to_pdf from "html-pdf-node";

// Optional: Register helpers if needed
handlebars.registerHelper('formatDate', function(date) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString();
});

export async function generateLoanPdf(data, templateName = "loan-details.html") {
  try {
    const templatesDir = path.resolve("./templates/pdf");
    
    // Load templates
    const headerHtml = await fs.readFile(path.join(templatesDir, "header.html"), "utf8");
    const footerHtml = await fs.readFile(path.join(templatesDir, "footer.html"), "utf8");
    const bodyHtmlRaw = await fs.readFile(path.join(templatesDir, templateName), "utf8");

    // Compile Handlebars template with data
    const template = handlebars.compile(bodyHtmlRaw);
    const compiledHtml = template(data);

    // PDF options
    let options = { 
      format: 'A4',
      margin: {
        top: "60px",
        bottom: "60px",
        left: "20px",
        right: "20px"
      },
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      printBackground: true
    };

    let file = { content: compiledHtml };

    // Generate PDF buffer
    const pdfBuffer = await html_to_pdf.generatePdf(file, options);
    
    return pdfBuffer;

  } catch (error) {
    console.error("PDF Generation Error:", error);
    throw new Error("Failed to generate PDF");
  }
}
