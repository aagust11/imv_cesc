export interface CESCQuestion {
  id: number;
  text: string;
  description: string;
}

export interface QuestionAnswer {
  questionId: number;
  choices: string[]; // Up to 3 choices
}

export interface StudentResponse {
  studentSessionId: string;
  studentName: string; // The self-identified name, or "Anònim" if disabled/not specified
  answers: { [questionId: number]: string[] }; // Map of question ID to the 3 selected names
  updatedAt: string;
}

export interface CESCProject {
  id: string;
  title: string;
  createdAt: string;
  students: string[]; // List of student names
  questions: CESCQuestion[]; // Customized or default questions
  allowSelfIdentification: boolean; // Toggle for student self-identification
  responses: { [studentSessionId: string]: StudentResponse }; // Responses indexed by studentSessionId
}

export interface ActiveSession {
  code: string; // 8-character uppercase session code
  project: CESCProject;
}

export const DEFAULT_QUESTIONS: CESCQuestion[] = [
  {
    id: 1,
    text: "Em cau bé",
    description: "Busca els tres nois i noies de la llista que et caiguin més bé, amb qui més t’agrada o t’agradaria anar."
  },
  {
    id: 2,
    text: "No em cau bé",
    description: "Ara, busca els tres nois i noies que no et cauen bé. Potser la majoria dels teus companys et caiguin bé, però has de pensar en els que et caiguin menys bé."
  },
  {
    id: 3,
    text: "Fa córrer rumors",
    description: "Busca els tres nois i noies que parlen malament d’una persona a les seves esquenes o escampen rumors sobre ella perquè no caigui bé als altres, perquè no vagin amb ell."
  },
  {
    id: 4,
    text: "Ajuda els altres",
    description: "Busca els tres nois i noies que fan coses bones per als altres, que els ajuden a integrar-se en el grup."
  },
  {
    id: 5,
    text: "Dóna empentes",
    description: "Busca els tres nois i noies que peguen, donen empentes, patades, intimiden, amenacen…"
  },
  {
    id: 6,
    text: "No deixa participar",
    description: "Busca els tres nois i noies que quan estan enfadats amb algú l’ignoren, fan com si no existís, o li diuen que marxi, i no deixen que estigui amb el seu grup d’amics."
  },
  {
    id: 7,
    text: "Anima els altres",
    description: "Busca els tres nois i noies que animen els companys quan estan disgustats o tristos, que els diuen coses per fer-los sentir bé."
  },
  {
    id: 8,
    text: "Insulta",
    description: "Busca els tres nois i noies que insulten, ridiculitzen o se’n riuen dels altres."
  },
  {
    id: 9,
    text: "A qui donen empentes?",
    description: "Busca tres nois i noies que acostumen a rebre empentes, cops, amenaces… dels altres."
  },
  {
    id: 10,
    text: "A qui insulten o ridiculitzen?",
    description: "Busca tres nois i noies que els altres sovint els insulten o se’n riuen o es fiquen amb ells."
  },
  {
    id: 11,
    text: "A qui no deixen participar?",
    description: "Busca tres nois i noies que sovint estan sols, que els altres no els trien per fer treballs, o no els conviden perquè no els agrada que vagin amb ells."
  },
  {
    id: 12,
    text: "Els meus amics / amigues?",
    description: "Busca tres nois i noies que són els teus millors amics."
  }
];
