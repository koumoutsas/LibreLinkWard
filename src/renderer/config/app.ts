type DropdownConfigType = {
  value: string
  label: string
}

const countries: DropdownConfigType[] = [
  { value: 'global', label: 'Global' },
  { value: 'de', label: 'Germany' },
  { value: 'eu', label: 'European Union' },
  { value: 'eu2', label: 'European Union 2' },
  { value: 'us', label: 'United States' },
  { value: 'ap', label: 'Asia/Pacific' },
  { value: 'ca', label: 'Canada' },
  { value: 'jp', label: 'Japan' },
  { value: 'ae', label: 'United Arab Emirates' },
  { value: 'fr', label: 'France' },
  { value: 'au', label: 'Australia' },
]

const languages: DropdownConfigType[] = [
  { value: 'bs', label: 'Bosnian' },
  { value: 'cs', label: 'Czech' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'it', label: 'Italian' },
  { value: 'no', label: 'Norwegian' },
  { value: 'ru', label: 'Russian' },
  { value: 'si', label: 'Sinhala' },
  { value: 'es', label: 'Spanish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'ta', label: 'Tamil' }
]


const themes: DropdownConfigType[] = [
  {
    label: 'Dark',
    value: 'dark',
  },
  {
    label: 'Light',
    value: 'light',
  },
  {
    label: 'System',
    value: 'system',
  },
];

const resultUnits: DropdownConfigType[] = [
  {
    label: 'mg/dL',
    value: 'mg/dL',
  },
  {
    label: 'mmol/L',
    value: 'mmol/L',
  },
];

export {
  countries,
  languages,
  themes,
  resultUnits,
}
