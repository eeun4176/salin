/**
 * Barangays of San Jose del Monte
 * The city's barangays by district, as printed on the census sheet. Each
 * one's position in BARANGAYS is the number encoded in the sheet's code
 * strip, so a printed sheet names its barangay without handwriting. Only
 * ever add new barangays at the end: reordering would change what printed
 * sheets mean.
 */

export interface Barangay {
  name: string;
  district: 1 | 2;
}

const DISTRICT_1 = [
  "Poblacion",
  "Poblacion 1",
  "Francisco Homes - Narra",
  "Francisco Homes - Mulawin",
  "Francisco Homes - Yakal",
  "Francisco Homes - Guijo",
  "Gumaok East",
  "Gumaok West",
  "Gumaok Central",
  "Graceville",
  "Gaya-gaya",
  "Sto. Cristo",
  "Tungkong Mangga",
  "Dulong Bayan",
  "Ciudad Real",
  "Maharlika",
  "San Manuel",
  "Kaypian",
  "San Isidro",
  "San Roque",
  "Kaybanban",
  "Paradise III",
  "Muzon Proper",
  "Muzon East",
  "Muzon South",
  "Muzon West",
];

const DISTRICT_2 = [
  "Minuyan Proper",
  "Minuyan I",
  "Minuyan II",
  "Minuyan III",
  "Minuyan IV",
  "Minuyan V",
  "Bagong Buhay I",
  "Bagong Buhay II",
  "Bagong Buhay III",
  "San Martin I",
  "San Martin II",
  "San Martin III",
  "San Martin IV",
  "Sta. Cruz I",
  "Sta. Cruz II",
  "Sta. Cruz III",
  "Sta. Cruz IV",
  "Sta. Cruz V",
  "Fatima I",
  "Fatima II",
  "Fatima III",
  "Fatima IV",
  "Fatima V",
  "Citrus",
  "San Pedro",
  "Sapang Palay Proper",
  "San Martin De Porres",
  "Assumption",
  "Sto. Niño I",
  "Sto. Niño II",
  "Lawang Pare",
  "San Rafael I",
  "San Rafael II",
  "San Rafael III",
  "San Rafael IV",
  "San Rafael V",
];

export const BARANGAYS: readonly Barangay[] = [...DISTRICT_1.map((name) => ({ name, district: 1 as const })), ...DISTRICT_2.map((name) => ({ name, district: 2 as const }))];

export const barangayName = (index: number) => BARANGAYS[index]?.name ?? null;
