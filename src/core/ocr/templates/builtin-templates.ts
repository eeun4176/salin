/**
 * Built-in Templates
 * The veterinary layouts Salin recognises out of the box: a printed pet
 * registration form (one pet per page, with checkbox choices), a census
 * sheet (a table of animals per household, with totals checked against the
 * rows), and a consent form (experimental — evaluated as an additional
 * layout). Generic mode needs no template: it extracts whatever fields and
 * tables it finds. Labels include common Filipino wordings.
 */

import { parseTemplate, type DocumentTemplateDef, type TemplateInput } from "@/core/ocr/templates/template-schema";

export const GENERIC_TEMPLATE_ID = "generic";

const registration: TemplateInput = {
  id: "vet-registration",
  name: "Pet registration form",
  description: "A printed form for one pet: owner, address, pet details, and rabies vaccination.",
  kind: "form",
  builtIn: true,
  fields: [
    { key: "registration_no", label: "Registration no.", aliases: ["Reg. No", "Registration number", "Tag No", "Control No"], type: "text" },
    { key: "date", label: "Date registered", aliases: ["Date", "Date of registration", "Petsa"], type: "date" },
    { key: "owner_name", label: "Owner's name", aliases: ["Name of owner", "Owner", "Owner name", "Pangalan ng may-ari"], type: "text", required: true },
    { key: "address", label: "Address", aliases: ["Home address", "Tirahan"], type: "text", required: true },
    { key: "barangay", label: "Barangay", aliases: ["Brgy", "Brgy."], type: "text" },
    { key: "contact", label: "Contact no.", aliases: ["Contact number", "Contact No", "Mobile No", "Cellphone No", "Phone", "Tel. No"], type: "text" },
    { key: "pet_name", label: "Pet's name", aliases: ["Name of pet", "Pet name", "Pangalan ng hayop"], type: "text", required: true },
    { key: "species", label: "Species", aliases: ["Kind of animal", "Animal", "Uri"], type: "choice", options: ["Dog", "Cat", "Other"], required: true },
    { key: "breed", label: "Breed", aliases: ["Lahi"], type: "text" },
    { key: "sex", label: "Sex", aliases: ["Gender", "Kasarian"], type: "choice", options: ["Male", "Female"] },
    { key: "age", label: "Age", aliases: ["Edad"], type: "text" },
    { key: "color", label: "Color", aliases: ["Colour", "Color/Markings", "Markings", "Kulay"], type: "text" },
    { key: "vaccinated", label: "Vaccinated against rabies", aliases: ["Anti-rabies vaccine", "Vaccinated", "Rabies vaccinated", "Rabies vaccine"], type: "boolean" },
  ],
};

const census: TemplateInput = {
  id: "vet-census",
  name: "Veterinary census sheet",
  description: "A table of animals per household (owner, pet, species, sex, age, vaccination) with totals.",
  kind: "table",
  builtIn: true,
  fields: [
    { key: "barangay", label: "Barangay", aliases: ["Brgy", "Brgy."], type: "text" },
    { key: "enumerator", label: "Enumerator", aliases: ["Census taker", "Surveyed by", "Prepared by", "Conducted by"], type: "text" },
    { key: "date", label: "Date", aliases: ["Date of census", "Petsa"], type: "date" },
  ],
  tables: [
    {
      key: "animals",
      label: "Animals",
      minMatched: 3,
      columns: [
        { key: "no", label: "No.", aliases: ["#", "No"], type: "number" },
        { key: "owner", label: "Owner", aliases: ["Owner's name", "Name of owner", "Owner name", "May-ari"], type: "text", required: true },
        { key: "address", label: "Address", aliases: ["Purok", "Sitio", "Address/Purok", "Household"], type: "text" },
        { key: "pet_name", label: "Pet name", aliases: ["Name of pet", "Pet", "Pet's name"], type: "text" },
        { key: "species", label: "Species", aliases: ["Kind", "Animal", "Dog/Cat", "Uri"], type: "text", required: true },
        { key: "sex", label: "Sex", aliases: ["M/F", "Gender"], type: "text" },
        { key: "age", label: "Age", aliases: ["Edad", "Age (yrs)"], type: "text" },
        { key: "vaccinated", label: "Vaccinated", aliases: ["Vaccinated (Y/N)", "Rabies vaccine", "Vacc.", "Anti-rabies"], type: "boolean" },
      ],
    },
  ],
  summaries: [
    { key: "total_animals", label: "Total animals", aliases: ["Total", "Total no. of animals", "Total number of animals"], type: "number", countOf: { table: "animals" } },
    { key: "total_dogs", label: "Total dogs", aliases: ["No. of dogs", "Dogs"], type: "number", countOf: { table: "animals", column: "species", equals: "Dog" } },
    { key: "total_cats", label: "Total cats", aliases: ["No. of cats", "Cats"], type: "number", countOf: { table: "animals", column: "species", equals: "Cat" } },
  ],
};

const consent: TemplateInput = {
  id: "vet-consent",
  name: "Veterinary consent form",
  description: "Owner's consent for a procedure. Experimental: signatures aren't read, only the printed and typed parts.",
  kind: "form",
  builtIn: true,
  experimental: true,
  fields: [
    { key: "owner_name", label: "Owner's name", aliases: ["Name of owner", "Owner", "Client"], type: "text", required: true },
    { key: "pet_name", label: "Pet's name", aliases: ["Name of pet", "Patient", "Pet name"], type: "text", required: true },
    { key: "species", label: "Species", aliases: ["Animal", "Kind"], type: "choice", options: ["Dog", "Cat", "Other"] },
    { key: "procedure", label: "Procedure", aliases: ["Treatment", "Surgery", "Operation", "Service"], type: "text", required: true },
    { key: "contact", label: "Contact no.", aliases: ["Contact number", "Mobile No", "Phone"], type: "text" },
    { key: "consent", label: "I agree", aliases: ["I consent", "I hereby consent", "Agree", "I give consent"], type: "boolean", required: true },
    { key: "date", label: "Date", aliases: ["Petsa"], type: "date", required: true },
  ],
};

export const BUILTIN_TEMPLATES: DocumentTemplateDef[] = [registration, census, consent].map(parseTemplate);

export function builtinTemplate(id: string) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}
