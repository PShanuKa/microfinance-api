import fs from "fs/promises";
import path from "path";
import handlebars from "handlebars";
import html_to_pdf from "html-pdf-node";
import { formatDateSL } from "../utils/dateHelpers.js";

// Optional: Register helpers if needed
handlebars.registerHelper('formatDate', function(date) {
  if (!date) return "-";
  return formatDateSL(date);
});

export async function generateLoanPdf(data, templateName = "loan-details.html") {
  try {
    const templatesDir = path.resolve("./templates/pdf");
    
    // Load templates
    const headerHtmlRaw = await fs.readFile(path.join(templatesDir, "header.html"), "utf8");
    const footerHtml = await fs.readFile(path.join(templatesDir, "footer.html"), "utf8");
    const bodyHtmlRaw = await fs.readFile(path.join(templatesDir, templateName), "utf8");

    // Determine logo and company name based on template
    const isMortgage = templateName === "mortgage-details.html";
    const logoFileName = isMortgage ? "don&dons.png" : "arunadayata_saviyak.png";
    const companyName = isMortgage ? "Don and don's" : "Arunadayata Saviyak";

    const logoPath = path.resolve(`./assets/${logoFileName}`);
    let logoBase64 = "";
    try {
      const logoBuffer = await fs.readFile(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
    } catch (err) {
      console.warn(`Logo ${logoFileName} not found for PDF generation`, err);
    }

    const templateData = { ...data, logoBase64, companyName };

    // Compile Handlebars templates with data
    const headerTemplateCompiled = handlebars.compile(headerHtmlRaw);
    const headerHtml = headerTemplateCompiled(templateData);

    const template = handlebars.compile(bodyHtmlRaw);
    let compiledHtml = template(templateData);

    // Inject header directly into the body to show it only on the first page
    compiledHtml = compiledHtml.replace("<body>", `<body>\n${headerHtml}\n`);

    // PDF options
    let options = { 
      format: 'A4',
      margin: {
        top: "40px", // reduced since header is no longer in the margin
        bottom: "60px",
        left: "20px",
        right: "20px"
      },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>", // empty header so it doesn't repeat
      footerTemplate: footerHtml,
      printBackground: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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
