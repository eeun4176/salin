/**
 * Built-in Templates
 * The veterinary layouts Salin recognises out of the box: a printed pet
 * registration form (one pet per page, with checkbox choices), a census
 * sheet (a table of animals per household, with totals checked against the
 * rows), and a consent form (experimental — evaluated as an additional
 * layout). Generic mode needs no template: it extracts whatever fields and
 * tables it finds. Labels include the wordings on the City Veterinary
 * Office's own forms, in English and Filipino ("Buong Pangalan ng
 * May-ari", "Kulay/Palatandaan"), and fields name the standard form to
 * suggest for values like sex and species.
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
    { key: "registration_no", label: "Registration no.", aliases: ["Reg. No", "Registration number", "Tag No", "Control No", "Numero ng Rehistro"], type: "text" },
    { key: "date", label: "Date registered", aliases: ["Date", "Date of registration", "Petsa", "Araw ng Pagrehistro"], type: "date", normalize: "date" },
    { key: "owner_name", label: "Owner's name", aliases: ["Name of owner", "Owner", "Owner name", "Pet owner's full name", "Pangalan ng may-ari", "Buong Pangalan ng May-ari"], type: "text", required: true, normalize: "title_case" },
    { key: "address", label: "Address", aliases: ["Home address", "Complete address", "Tirahan", "Kumpletong Lokasyon ng Tirahan"], type: "text", required: true },
    { key: "barangay", label: "Barangay", aliases: ["Brgy", "Brgy."], type: "text" },
    { key: "contact", label: "Contact no.", aliases: ["Contact number", "Contact No", "Mobile No", "Cellphone No", "Phone", "Tel. No", "Numero ng Telepono"], type: "text" },
    { key: "email", label: "Email", aliases: ["E-mail", "Sulatroniko"], type: "text" },
    { key: "pet_name", label: "Pet's name", aliases: ["Name of pet", "Pet name", "Dog's name", "Pangalan ng hayop", "Pangalan ng Aso"], type: "text", required: true },
    { key: "species", label: "Species", aliases: ["Kind of animal", "Animal", "Type of pet"], type: "choice", options: ["Dog", "Cat", "Other"], required: true, normalize: "species" },
    { key: "breed", label: "Breed", aliases: ["Lahi", "Uri"], type: "text" },
    { key: "sex", label: "Sex", aliases: ["Gender", "Kasarian"], type: "choice", options: ["Male", "Female"], normalize: "sex" },
    { key: "age", label: "Age", aliases: ["Edad", "Date of birth/Age", "Petsa ng kapanganakan/Edad"], type: "text" },
    { key: "color", label: "Color", aliases: ["Colour", "Color/Markings", "Markings", "Kulay", "Kulay/Palatandaan"], type: "text" },
    { key: "vaccinated", label: "Vaccinated against rabies", aliases: ["Anti-rabies vaccine", "Vaccinated", "Rabies vaccinated", "Rabies vaccine"], type: "boolean", normalize: "yes_no" },
    { key: "last_rabies_vaccination", label: "Date of latest rabies vaccination", aliases: ["Last rabies vaccination", "Huling Petsa ng Bakuna para sa sakit na Rabis"], type: "date", normalize: "date" },
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
        { key: "owner", label: "Owner", aliases: ["Owner's name", "Name of owner", "Owner name", "May-ari", "Pangalan ng May-ari"], type: "text", required: true, normalize: "title_case" },
        { key: "address", label: "Address", aliases: ["Purok", "Sitio", "Address/Purok", "Household", "Complete address", "Kumpletong Lokasyon ng Tirahan"], type: "text" },
        { key: "pet_name", label: "Pet name", aliases: ["Name of pet", "Pet", "Pet's name", "Pangalan ng alaga"], type: "text" },
        { key: "species", label: "Species", aliases: ["Kind", "Animal", "Dog/Cat", "Type of pet"], type: "text", required: true, normalize: "species" },
        { key: "sex", label: "Sex", aliases: ["M/F", "Gender", "Kasarian"], type: "text", normalize: "sex" },
        { key: "age", label: "Age", aliases: ["Edad", "Age (yrs)"], type: "text" },
        { key: "vaccinated", label: "Vaccinated", aliases: ["Vaccinated (Y/N)", "Rabies vaccine", "Vacc.", "Anti-rabies", "Vaccination status"], type: "boolean", normalize: "yes_no" },
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
    { key: "owner_name", label: "Owner's name", aliases: ["Name of owner", "Owner", "Client", "Pet owner's name/Authorize representative"], type: "text", required: true, normalize: "title_case" },
    { key: "address", label: "Address", aliases: ["Home address", "Tirahan"], type: "text" },
    { key: "pet_name", label: "Pet's name", aliases: ["Name of pet", "Patient", "Pet name", "Patient's name"], type: "text", required: true },
    { key: "species", label: "Species", aliases: ["Animal", "Kind"], type: "choice", options: ["Dog", "Cat", "Other"], normalize: "species" },
    { key: "breed", label: "Breed", aliases: ["Lahi"], type: "text" },
    { key: "sex", label: "Sex", aliases: ["Kasarian"], type: "choice", options: ["Male", "Female"], normalize: "sex" },
    { key: "color", label: "Color/Markings", aliases: ["Color", "Markings", "Kulay"], type: "text" },
    { key: "procedure", label: "Procedure", aliases: ["Treatment", "Surgery", "Operation", "Service"], type: "text", required: true },
    { key: "contact", label: "Contact no.", aliases: ["Contact number", "Mobile No", "Phone", "Tel. No./Mobile No."], type: "text" },
    { key: "consent", label: "I agree", aliases: ["I consent", "I hereby consent", "Agree", "I give consent"], type: "boolean", required: true },
    { key: "date", label: "Date", aliases: ["Petsa"], type: "date", required: true },
  ],
};

export const BUILTIN_TEMPLATES: DocumentTemplateDef[] = [registration, census, consent].map(parseTemplate);

export function builtinTemplate(id: string) {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}
