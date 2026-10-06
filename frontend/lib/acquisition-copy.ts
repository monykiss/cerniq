export type AcquisitionLang = "en" | "es";

export interface AcquisitionCopy {
  primaryCta: string;
  primaryCtaWithPrice: string;
  proofCta: string;
  salesCta: string;
  upgradeCta: string;
  pilotPathDescription: string;
  pilotFormSectionLabel: string;
  pilotFormHeading: string;
  pilotFormIntro: string;
  pilotFormSubmit: string;
  pilotFormSuccessTitle: string;
  pilotFormSuccessBody: string;
  pricingHeroTitle: string;
  pricingHeroBody: string;
  contactKicker: string;
  contactHeading: string;
  contactBody: string;
  contactSubmit: string;
  contactSuccessTitle: string;
  contactSuccessBody: string;
  getStartedEyebrow: string;
  getStartedTitle: string;
  getStartedBody: string;
}

export function getAcquisitionCopy(lang: AcquisitionLang): AcquisitionCopy {
  if (lang === "es") {
    return {
      primaryCta: "Comenzar piloto",
      primaryCtaWithPrice: "Comenzar piloto — $750",
      proofCta: "Ver demo interactivo",
      salesCta: "Contactar ventas",
      upgradeCta: "Activar acceso recurrente",
      pilotPathDescription:
        "Traiga su balance para validar reportes, contexto de riesgo y salida institucional en un solo flujo.",
      pilotFormSectionLabel: "Comience su piloto",
      pilotFormHeading: "Cuentenos sobre su institucion",
      pilotFormIntro:
        "Comparta el contexto operativo de su institucion para iniciar un piloto basado en trabajo real, no en una demostracion generica.",
      pilotFormSubmit: "Continuar al piloto",
      pilotFormSuccessTitle: "Perfil de la institucion capturado",
      pilotFormSuccessBody:
        "Recibimos su contexto institucional. Lo usaremos para preparar el siguiente paso de su piloto y darle seguimiento si hace falta algun dato adicional.",
      pricingHeroTitle:
        "Comience con un piloto. Active acceso recurrente cuando el flujo ya este validado.",
      pricingHeroBody:
        "Un solo camino comercial: primero valide la calidad operativa y del informe con su balance, luego pase a acceso recurrente cuando su equipo confie en el flujo.",
      contactKicker: "Contactar ventas",
      contactHeading:
        "Hable con ventas sobre socios, asesoria o implementacion asistida",
      contactBody:
        "Use esta ruta si necesita precios para partners, una revision de seguridad o una implementacion guiada. Si solo quiere evaluar CERNIQ, comience con el piloto.",
      contactSubmit: "Contactar ventas",
      contactSuccessTitle: "Solicitud comercial recibida",
      contactSuccessBody:
        "Le responderemos dentro de 24 horas para evaluar necesidades de partner, enterprise o implementacion asistida.",
      getStartedEyebrow: "Ingreso de piloto",
      getStartedTitle: "Comience su piloto con su hoja de balance",
      getStartedBody:
        "Un solo flujo claro: capture el contexto de su institucion, revise la salida y active el piloto de $750 cuando este listo para usar datos reales.",
    };
  }

  return {
    primaryCta: "Start Pilot",
    primaryCtaWithPrice: "Start Pilot — $750",
    proofCta: "View Interactive Demo",
    salesCta: "Contact Sales",
    upgradeCta: "Upgrade to Recurring Access",
    pilotPathDescription:
      "Bring in your balance sheet to validate reporting, risk context, and institutional output in one workflow.",
    pilotFormSectionLabel: "Start Your Pilot",
    pilotFormHeading: "Tell Us About Your Institution",
    pilotFormIntro:
      "Share the operating basics of your institution so we can route you into a real-data pilot instead of a generic demo handoff.",
    pilotFormSubmit: "Continue to Pilot",
    pilotFormSuccessTitle: "Institution Profile Captured",
    pilotFormSuccessBody:
      "We captured your institution profile and will use it to prepare the next step of your pilot. We will follow up only if we need anything else.",
    pricingHeroTitle:
      "Start with a pilot. Upgrade to recurring access when the workflow is trusted.",
    pricingHeroBody:
      "One acquisition path: validate the operating workflow and output quality with your balance sheet first, then move into recurring access once your team trusts the system.",
    contactKicker: "Contact Sales",
    contactHeading: "Talk to Sales About Partner or Assisted Rollout",
    contactBody:
      "Use this route for partner pricing, advisor needs, security review, or guided rollout support. If you just want to evaluate CERNIQ, start with the pilot.",
    contactSubmit: "Contact Sales",
    contactSuccessTitle: "Sales Request Received",
    contactSuccessBody:
      "We will reach out within 24 hours to scope partner, enterprise, or assisted onboarding needs.",
    getStartedEyebrow: "Pilot Intake",
    getStartedTitle: "Start Your Pilot with Your Balance Sheet",
    getStartedBody:
      "One clear path: capture your institution context, review the operating output, and activate the $750 pilot when you are ready to use real data.",
  };
}
