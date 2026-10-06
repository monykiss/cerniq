import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;

  private frontendUrl(): string {
    return (process.env.FRONTEND_URL || 'https://cerniq.io')
      .trim()
      .replace(/\/+$/, '');
  }

  constructor() {
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
      this.logger.log('Resend email client initialized');
    } else {
      this.logger.warn('RESEND_API_KEY not set — email notifications disabled');
    }
  }

  /**
   * Operator inbox for internal notifications and Reply-To. Configuration
   * only — there is no built-in address. Internal alerts are skipped when
   * OPS_NOTIFY_EMAIL is unset.
   */
  private adminEmail(): string | undefined {
    return (process.env.OPS_NOTIFY_EMAIL || '').trim() || undefined;
  }

  private requireAdminEmail(): string {
    const email = this.adminEmail();
    if (!email) {
      throw new Error(
        'OPS_NOTIFY_EMAIL not configured — internal alert not sent',
      );
    }
    return email;
  }

  private senderFrom(name = 'CERNIQ'): string {
    const domain = process.env.EMAIL_FROM_DOMAIN || 'example.com';
    return `${name} <onboarding@${domain}>`;
  }

  private alertFrom(): string {
    const domain = process.env.EMAIL_FROM_DOMAIN || 'example.com';
    return `CERNIQ Alerts <alerts@${domain}>`;
  }

  // ── HTML wrapper ──────────────────────────────────────

  private wrap(bodyHtml: string, ctaUrl?: string, ctaText?: string): string {
    const cta =
      ctaUrl && ctaText
        ? `
      <div style="margin: 28px 0 8px; text-align: center;">
        <a href="${ctaUrl}" style="background: #E8A020; color: #FFFFFF; padding: 16px 36px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px; display: inline-block;">${ctaText}</a>
      </div>`
        : '';
    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
      <body style="margin:0;padding:0;background:#F8FAFC;font-family:Georgia,serif;">
      <div style="max-width: 580px; margin: 0 auto;">
        <div style="background: #1B3A6B; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <span style="color: #FFFFFF; font-size: 22px; font-weight: bold; letter-spacing: -0.5px;">CERNIQ</span>
          <span style="color: #93C5FD; font-size: 11px; margin-left: 8px;">by KLYTICS LLC</span>
        </div>
        <div style="background: #FFFFFF; padding: 32px 32px 24px; border: 1px solid #E2E8F0; border-top: none; line-height: 1.7; color: #1E293B; font-size: 15px;">
          ${bodyHtml}
          ${cta}
        </div>
        <div style="background: #F1F5F9; padding: 16px 32px; border-radius: 0 0 8px 8px; border: 1px solid #E2E8F0; border-top: none;">
          <p style="margin: 0; font-size: 11px; color: #64748B; line-height: 1.6;">
            CERNIQ &middot; KLYTICS LLC &middot; San Juan, Puerto Rico &middot; hello@cerniq.io<br>
            <a href="https://cerniq.io/privacy" style="color: #64748B;">Privacidad</a> &middot;
            <a href="https://cerniq.io/terms" style="color: #64748B;">T&eacute;rminos</a>
          </p>
        </div>
      </div>
      </body>
      </html>`;
  }

  private readonly SIGNATURE_ES = `<p style="margin-top: 28px; color: #475569; font-size: 14px;">Cordialmente,<br><strong>El equipo de CERNIQ</strong></p>`;
  private readonly SIGNATURE_EN = `<p style="margin-top: 16px; color: #475569; font-size: 14px;">Best,<br><strong>The CERNIQ team</strong></p>`;
  private readonly DIVIDER = `<hr style="border: none; border-top: 2px solid #E2E8F0; margin: 32px 0;">`;

  // ── 1. Client Welcome ─────────────────────────────────

  async sendClientWelcome(data: {
    email: string;
    name: string;
    tier: string;
    magicUrl: string;
    institutionName: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Client welcome: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Bienvenido a CERNIQ, ${data.institutionName} — Sus proximos pasos / Welcome to CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Le escribo personalmente para darle la bienvenida a CERNIQ. Su pago ha sido confirmado y su portal ya esta activo.</p>
           <p><strong>Plan:</strong> ${data.tier}<br>
           <strong>Institucion:</strong> ${data.institutionName}</p>
           <p>Sus proximos pasos:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Acceda a su portal</strong> — haga clic en el boton de abajo (enlace valido por 24 horas)</li>
             <li><strong>Descargue la plantilla CSV</strong> — en su portal encontrara la plantilla para cargar sus datos de balance</li>
             <li><strong>Suba sus datos</strong> — una vez cargados, su informe ALM se genera automaticamente</li>
           </ol>
           <p>Responda este email — yo personalmente respondo cada mensaje.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>I'm writing personally to welcome you to CERNIQ. Your payment has been confirmed and your portal is now active.</p>
           <p><strong>Plan:</strong> ${data.tier}<br>
           <strong>Institution:</strong> ${data.institutionName}</p>
           <p>Your next steps:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Access your portal</strong> — click the button below (link valid for 24 hours)</li>
             <li><strong>Download the CSV template</strong> — you'll find the template in your portal to upload your balance sheet data</li>
             <li><strong>Upload your data</strong> — once uploaded, your ALM report is generated automatically</li>
           </ol>
           <p>Reply to this email — I personally respond to every message.</p>
           ${this.SIGNATURE_EN}`,
          data.magicUrl,
          'Acceder al portal / Access portal',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send welcome: ${err}`);
    }
  }

  // ── 2. Data Submission Acknowledgment ──────────────────

  async sendDataSubmissionAck(data: {
    email: string;
    name: string;
    institutionName: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Data ack: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Datos recibidos — Procesando su analisis ALM, ${data.institutionName}`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Confirmamos que hemos recibido los datos de <strong>${data.institutionName}</strong>. Nuestro sistema ya esta procesando su analisis ALM.</p>
           <p>Esto es lo que sucede ahora:</p>
           <ul style="color: #334155; line-height: 2;">
             <li><strong>Validacion de datos</strong> — verificamos integridad y formato de sus posiciones</li>
             <li><strong>Calculo de brecha de duracion</strong> — sensibilidad de tasa a +/-100, 200 y 300 bps</li>
             <li><strong>Simulacion Monte Carlo</strong> — 1,000 escenarios de tasa con 4 escenarios regulatorios</li>
             <li><strong>Generacion de PDF</strong> — informe bilingue de 14+ paginas listo para junta directiva</li>
           </ul>
           <p>Tiempo estimado: <strong>24-48 horas habiles</strong>. Le notificaremos por email cuando su informe este listo.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>We confirm that the data for <strong>${data.institutionName}</strong> has been received. Our system is already processing your ALM analysis.</p>
           <p>Here is what happens now:</p>
           <ul style="color: #334155; line-height: 2;">
             <li><strong>Data validation</strong> — we verify the integrity and format of your positions</li>
             <li><strong>Duration gap calculation</strong> — rate sensitivity at +/-100, 200, and 300 bps</li>
             <li><strong>Monte Carlo simulation</strong> — 1,000 rate scenarios across 4 regulatory stress tests</li>
             <li><strong>PDF generation</strong> — bilingual 14+ page report ready for your board</li>
           </ul>
           <p>Estimated time: <strong>24-48 business hours</strong>. We will notify you by email when your report is ready.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/dashboard`,
          'Ver estado en dashboard / Check status in dashboard',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send data ack: ${err}`);
    }
  }

  // ── 3. Report Ready ───────────────────────────────────

  async sendReportReady(data: {
    email: string;
    name: string;
    institutionName: string;
    portalUrl: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Report ready: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Su Informe ALM esta listo — ${data.institutionName} / Your ALM Report is Ready`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Excelentes noticias — su informe ALM de <strong>${data.institutionName}</strong> esta completo y listo para descargar.</p>
           <p>Su informe de <strong>14+ paginas</strong> incluye:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Resumen ejecutivo</strong> — hallazgos clave para su junta directiva</li>
             <li><strong>Analisis de brecha de duracion</strong> — perfil completo de riesgo de tasa</li>
             <li><strong>Sensibilidad NII</strong> — impacto en ingreso neto por interes a multiples escenarios</li>
             <li><strong>Simulacion Monte Carlo</strong> — 1,000 trayectorias con intervalos de confianza</li>
             <li><strong>Evaluacion de cumplimiento COSSEC</strong> — alineado con requisitos regulatorios vigentes</li>
             <li><strong>Recomendaciones estrategicas</strong> — acciones concretas para mitigar riesgos</li>
           </ol>
           <p>Si desea que revisemos los resultados juntos en una sesion de 15 minutos, responda a este email y coordinamos.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Great news — your ALM report for <strong>${data.institutionName}</strong> is complete and ready to download.</p>
           <p>Your <strong>14+ page</strong> report includes:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Executive summary</strong> — key findings for your board of directors</li>
             <li><strong>Duration gap analysis</strong> — complete interest rate risk profile</li>
             <li><strong>NII sensitivity</strong> — net interest income impact across multiple scenarios</li>
             <li><strong>Monte Carlo simulation</strong> — 1,000 paths with confidence intervals</li>
             <li><strong>COSSEC compliance assessment</strong> — aligned with current regulatory requirements</li>
             <li><strong>Strategic recommendations</strong> — concrete actions to mitigate risks</li>
           </ol>
           <p>If you'd like to review the results together in a 15-minute session, reply to this email and we'll coordinate.</p>
           ${this.SIGNATURE_EN}`,
          data.portalUrl,
          'Descargar informe ahora / Download report now',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send report ready: ${err}`);
    }
  }

  // ── Demo Portal Ready (sales: prospect → portal handoff) ─────

  async sendDemoPortalReady(data: {
    email: string;
    name: string;
    institutionName: string;
    magicLinkUrl: string;
    asOfQuarter: string;
    disclosure: string;
    expiresAt: Date;
    language: 'es' | 'en';
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Demo portal ready: ${data.email}`);
      return;
    }
    const expiresLabel = data.expiresAt.toISOString().slice(0, 10);
    const subject =
      data.language === 'es'
        ? `Su portal CERNIQ esta listo — ${data.institutionName}`
        : `Your CERNIQ portal is ready — ${data.institutionName}`;
    const ctaText =
      data.language === 'es' ? 'Acceder al portal' : 'Open your portal';

    const bodyEs = `<p>Hola ${data.name || ''},</p>
       <p>Hemos preparado un portal CERNIQ para <strong>${data.institutionName}</strong> usando datos publicos de COSSEC (${data.asOfQuarter}). No necesita cargar nada — el informe ALM completo ya esta dentro.</p>
       <p>Lo que encontrara:</p>
       <ol style="color: #334155; line-height: 2;">
         <li><strong>Informe ALM completo</strong> — brecha de duracion, sensibilidad NII, EVE, Monte Carlo</li>
         <li><strong>Cumplimiento COSSEC</strong> — los 12 ratios calculados contra los umbrales vigentes</li>
         <li><strong>Paquete de Junta (ALCO)</strong> — PDF de 8 paginas listo para imprimir</li>
         <li><strong>Comparacion con la mediana del sector</strong> — donde esta su cooperativa frente a las 109 inscritas en COSSEC</li>
       </ol>
       <p style="background: #FEF3C7; padding: 12px; border-radius: 6px; font-size: 13px; color: #78350F;">${data.disclosure}. Acceso valido hasta ${expiresLabel}. Una vez dentro, puede refinar el informe con sus numeros reales en cualquier momento.</p>
       <p>Si quiere que repasemos el informe juntos en una llamada de 15 minutos, responda a este email.</p>
       ${this.SIGNATURE_ES}`;

    const bodyEn = `<p>Hi ${data.name || ''},</p>
       <p>We've prepared a CERNIQ portal for <strong>${data.institutionName}</strong> using public NCUA / COSSEC filings (${data.asOfQuarter}). Nothing for you to upload — the full ALM report is already inside.</p>
       <p>What you'll find:</p>
       <ol style="color: #334155; line-height: 2;">
         <li><strong>Full ALM report</strong> — duration gap, NII sensitivity, EVE, Monte Carlo</li>
         <li><strong>Regulatory compliance</strong> — all 12 ratios scored against current thresholds</li>
         <li><strong>Board (ALCO) pack</strong> — print-ready 8-page PDF</li>
         <li><strong>Sector benchmarking</strong> — where you sit vs. peers</li>
       </ol>
       <p style="background: #FEF3C7; padding: 12px; border-radius: 6px; font-size: 13px; color: #78350F;">${data.disclosure}. Access valid until ${expiresLabel}. Once inside, you can refine the report with your real numbers any time.</p>
       <p>If you'd like to walk through the report together in a 15-minute call, reply to this email.</p>
       ${this.SIGNATURE_EN}`;

    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject,
        html: this.wrap(
          data.language === 'es'
            ? `${bodyEs}${this.DIVIDER}${bodyEn}`
            : `${bodyEn}${this.DIVIDER}${bodyEs}`,
          data.magicLinkUrl,
          ctaText,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send demo portal ready: ${err}`);
    }
  }

  // ── Demo Expiry Reminder (T-3 nudge before demo window closes) ──

  async sendDemoExpiryReminder(data: {
    email: string;
    name: string;
    institutionName: string;
    magicLinkUrl: string;
    daysRemaining: number;
    upgradeUrl: string;
    language: 'es' | 'en';
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Demo expiry reminder: ${data.email}`);
      return;
    }
    const subject =
      data.language === 'es'
        ? `${data.daysRemaining} día${data.daysRemaining === 1 ? '' : 's'} restante${data.daysRemaining === 1 ? '' : 's'} — su análisis CERNIQ`
        : `${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'} left on your CERNIQ analysis`;
    const ctaText =
      data.language === 'es' ? 'Mantener mi análisis' : 'Keep my analysis';

    const bodyEs = `<p>Hola ${data.name || ''},</p>
       <p>Un recordatorio rápido: su análisis CERNIQ de <strong>${data.institutionName}</strong> expira en <strong>${data.daysRemaining} día${data.daysRemaining === 1 ? '' : 's'}</strong>.</p>
       <p>Después de la expiración, el portal ya no será accesible y necesitará re-provisionar el análisis desde cero. Si quiere mantener su informe, duration gap, prueba de estrés Monte Carlo, y paquete ALCO, active una suscripción ahora — sus datos, institución y informe se conservan intactos.</p>
       <p style="background: #FEF3C7; padding: 12px; border-radius: 6px; font-size: 13px; color: #78350F;">
         <strong>¿Qué sucede si actualiza?</strong><br>
         • Su workspace actual se preserva<br>
         • El informe existente sigue disponible<br>
         • Puede refinar con sus datos reales en cualquier momento<br>
         • Acceso ilimitado a los 34 modelos cuantitativos + 200+ módulos ALM
       </p>
       <p>¿Prefiere una llamada rápida antes de decidir? Responda a este email y coordinamos 15 minutos.</p>
       ${this.SIGNATURE_ES}`;

    const bodyEn = `<p>Hi ${data.name || ''},</p>
       <p>Quick reminder: your CERNIQ analysis for <strong>${data.institutionName}</strong> expires in <strong>${data.daysRemaining} day${data.daysRemaining === 1 ? '' : 's'}</strong>.</p>
       <p>After expiry the portal will no longer be accessible and you'd need to re-provision the analysis from scratch. If you want to keep your report, duration gap, Monte Carlo stress test, and ALCO pack, activate a subscription now — your data, institution, and report are preserved intact.</p>
       <p style="background: #FEF3C7; padding: 12px; border-radius: 6px; font-size: 13px; color: #78350F;">
         <strong>What happens when you upgrade?</strong><br>
         • Your current workspace is preserved<br>
         • Existing report stays available<br>
         • You can refine with real data any time<br>
         • Unlimited access to all 34 quant models + 200+ ALM modules
       </p>
       <p>Prefer a quick call first? Reply to this email and we'll book 15 minutes.</p>
       ${this.SIGNATURE_EN}`;

    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject,
        html: this.wrap(
          data.language === 'es'
            ? `${bodyEs}${this.DIVIDER}${bodyEn}`
            : `${bodyEn}${this.DIVIDER}${bodyEs}`,
          data.upgradeUrl,
          ctaText,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send demo expiry reminder: ${err}`);
    }
  }

  // ── 4. Magic Link / Data Reminder ─────────────────────

  async sendMagicLinkEmail(data: {
    email: string;
    magicUrl: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Magic link: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          `${data.name || ''} — Sus datos de balance estan pendientes / Your balance data is pending`.trim(),
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Le escribo porque sus datos de balance aun estan pendientes en su portal CERNIQ. Entiendo que preparar los datos puede tomar tiempo — estoy aqui para ayudar.</p>
           <p>Para facilitar el proceso:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>En su portal encontrara una <strong>plantilla CSV</strong> pre-formateada</li>
             <li>Solo necesita sus posiciones de activos y pasivos con fechas de vencimiento</li>
             <li>El proceso completo toma menos de 10 minutos</li>
           </ul>
           <p>Si necesita ayuda con el formato o tiene preguntas sobre los datos requeridos, responda a este correo y le asisto personalmente.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>I'm writing because your balance sheet data is still pending in your CERNIQ portal. I understand preparing the data can take time — I'm here to help.</p>
           <p>To make the process easier:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Your portal includes a <strong>pre-formatted CSV template</strong></li>
             <li>You only need your asset and liability positions with maturity dates</li>
             <li>The entire process takes less than 10 minutes</li>
           </ul>
           <p>If you need help with the format or have questions about the required data, reply to this email and I'll assist you personally.</p>
           ${this.SIGNATURE_EN}`,
          data.magicUrl,
          'Cargar datos ahora / Upload data now',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send magic link: ${err}`);
    }
  }

  // ── 5. Job Failed Alert (plain text to operator inbox) ─────────

  async sendJobFailedAlert(data: {
    jobId: string;
    institutionName: string;
    error: string;
    clientEmail: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Job failed alert: ${data.jobId}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `FAILED: ${data.institutionName} — Job ${data.jobId}`,
        text: `Report generation failed.\n\nJob ID: ${data.jobId}\nInstitution: ${data.institutionName}\nClient: ${data.clientEmail}\nError: ${data.error}\n\nCheck pipeline: ${this.frontendUrl()}/admin/pipeline`,
      });
    } catch (err) {
      this.logger.error(`Failed to send job failed alert: ${err}`);
    }
  }

  // ── 6. Demo Request Notification (plain text to operator inbox) ─

  async sendDemoRequestNotification(data: {
    name?: string;
    email: string;
    institutionName?: string;
    institutionType?: string;
    totalAssets?: string;
  }): Promise<void> {
    if (!this.resend) return;

    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `NEW LEAD: ${data.institutionName || data.email}`,
        text: `New demo request received.\n\nName: ${data.name || '—'}\nEmail: ${data.email}\nInstitution: ${data.institutionName || '—'}\nType: ${data.institutionType || '—'}\nAsset range: ${data.totalAssets || '—'}\n\nReply directly: ${data.email}`,
      });
      this.logger.log(`Demo request notification sent for ${data.email}`);
    } catch (err) {
      this.logger.error(`Failed to send demo request notification: ${err}`);
    }
  }

  // ── Lead Notification (internal alert to operator inbox) ───────

  async sendLeadNotification(data: {
    leadId: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    institutionName: string;
    institutionType: string;
    message?: string;
    priority: string;
    nextFollowUp: Date;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(
        `[DRY RUN] Lead notification: ${data.institutionName} (${data.priority})`,
      );
      return;
    }

    const followUpStr = data.nextFollowUp.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Puerto_Rico',
    });

    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `NEW LEAD [${data.priority}]: ${data.institutionName} — ${data.institutionType}`,
        text: `New lead: ${data.name} from ${data.institutionName}\n\nRole: ${data.role}\nType: ${data.institutionType}\nEmail: ${data.email}${data.phone ? `\nPhone: ${data.phone}` : ''}${data.message ? `\nMessage: ${data.message}` : ''}\nPriority: ${data.priority}\nFollow-up: ${followUpStr}\n\nAdmin: ${this.frontendUrl()}/admin/leads/${data.leadId}`,
      });
      this.logger.log(`Lead notification sent for ${data.email}`);
    } catch (err) {
      this.logger.error(`Failed to send lead notification: ${err}`);
    }
  }

  // ── Lead Confirmation (bilingual, to prospect) ────────

  async sendLeadConfirmation(data: {
    name: string;
    email: string;
    institutionName: string;
    bilingual: boolean;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Lead confirmation to: ${data.email}`);
      return;
    }

    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Solicitud recibida — ${data.institutionName} / Your ALM Request — CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name},</p>
           <p>Gracias por comunicarse. Hemos recibido su solicitud de analisis ALM para <strong>${data.institutionName}</strong>.</p>
           <p>Proximos pasos:</p>
           <ol style="color: #334155; line-height: 2;">
             <li>Procesaremos los datos financieros publicos de su institucion</li>
             <li>Recibira un informe ALM completo dentro de 48 horas</li>
             <li>Incluiremos hallazgos clave y alertas regulatorias</li>
           </ol>
           <p>Responda directamente a este correo si tiene preguntas — yo personalmente respondo.</p>
           ${this.SIGNATURE_ES}

           ${
             data.bilingual
               ? `${this.DIVIDER}
           <p>Hi ${data.name},</p>
           <p>Thank you for reaching out. We've received your request for an ALM analysis for <strong>${data.institutionName}</strong>.</p>
           <p>Next steps:</p>
           <ol style="color: #334155; line-height: 2;">
             <li>We'll process your institution's public financial data</li>
             <li>You'll receive a full ALM report within 48 hours</li>
             <li>We'll include key findings and any regulatory flags</li>
           </ol>
           <p>Reply directly to this email if you have questions — I personally respond.</p>
           ${this.SIGNATURE_EN}`
               : ''
           }`,
        ),
      });
      this.logger.log(`Lead confirmation sent to ${data.email}`);
    } catch (err) {
      this.logger.error(`Failed to send lead confirmation: ${err}`);
    }
  }

  // ── Revenue Alert (internal, to operator inbox) ────────────────

  async sendRevenueAlert(data: {
    amount: number;
    tier: string;
    customerEmail: string;
    institutionName: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Revenue alert: $${data.amount}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `REVENUE: $${data.amount} — ${data.institutionName} — ${data.tier}`,
        text: `New payment received.\n\nAmount: $${data.amount}\nTier: ${data.tier}\nClient: ${data.customerEmail}\nInstitution: ${data.institutionName}\n\nAdmin: ${this.frontendUrl()}/admin/leads`,
      });
    } catch (err) {
      this.logger.error(`Failed to send revenue alert: ${err}`);
    }
  }

  // ── Payment Failed (bilingual, to client) ─────────────

  async sendPaymentFailed(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Payment failed: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: 'Problema con su pago — CERNIQ / Payment Issue',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Le escribo porque no pudimos procesar su ultimo pago en CERNIQ. Para evitar interrupciones en su servicio de reportes ALM, por favor actualice su metodo de pago.</p>
           <p>Si tiene alguna pregunta sobre su cuenta, responda a este correo y le ayudo directamente.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>I'm writing because we were unable to process your last payment for CERNIQ. To avoid interruptions to your ALM reporting service, please update your payment method.</p>
           <p>If you have any questions about your account, reply to this email and I'll help directly.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/portal/billing`,
          'Actualizar pago / Update payment',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send payment failed: ${err}`);
    }
  }

  // ── Cancellation (bilingual) ─────

  async sendCancellationEmail(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Cancellation: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          'Lamentamos verle ir — una nota personal / A personal note — CERNIQ',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Su suscripcion a CERNIQ ha sido cancelada. Quiero que sepa que sus informes historicos permaneceran disponibles en su portal.</p>
           <p>Si hay algo que podamos mejorar o si la cancelacion fue por un motivo que puedo resolver, por favor respondame directamente. Valoro sinceramente su opinion.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Your CERNIQ subscription has been cancelled. I want you to know that your historical reports will remain available in your portal.</p>
           <p>If there is anything we can improve, or if the cancellation was for a reason I can address, please reply directly. I sincerely value your feedback.</p>
           ${this.SIGNATURE_EN}`,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send cancellation: ${err}`);
    }
  }

  // ── Monthly Report Cycle (bilingual) ──────────────────

  async sendMonthlyReportCycle(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Monthly cycle: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          'Nuevo ciclo de reporte — envie sus datos actualizados / New reporting cycle — CERNIQ',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Su renovacion mensual ha sido procesada y un nuevo ciclo de reporte ha comenzado. Para generar su informe ALM de este periodo, envie su balance actualizado a traves de su portal.</p>
           <p>Si necesita ayuda, respondame directamente.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Your monthly renewal has been processed and a new reporting cycle has begun. To generate your ALM report for this period, submit your updated balance sheet through your portal.</p>
           <p>If you need help, reply directly.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/portal/submit?createCycle=1`,
          'Enviar datos / Submit data',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send monthly cycle: ${err}`);
    }
  }

  // ── Dispute Alert (plain text, internal) ──────────────

  async sendDisputeAlert(data: {
    chargeId: string;
    amount: number;
    reason: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Dispute alert: ${data.chargeId}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `DISPUTE: $${data.amount} — ${data.reason}`,
        text: `Dispute alert — immediate action required.\n\nCharge: ${data.chargeId}\nAmount: $${data.amount}\nReason: ${data.reason}\n\nRespond in Stripe Dashboard immediately.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send dispute alert: ${err}`);
    }
  }

  // ── Daily Operations Report (internal) ────────────────

  async sendDailyOperationsReport(data: {
    pendingJobs: number;
    failedJobs: number;
    newLeads: number;
    pendingFollowUps: number;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Daily ops report`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `Daily Ops: ${data.newLeads} leads, ${data.pendingJobs} pending, ${data.failedJobs} failed`,
        text: `Daily Operations Report\n\nNew Leads (24h): ${data.newLeads}\nOverdue Follow-ups: ${data.pendingFollowUps}\nPending Jobs: ${data.pendingJobs}\nFailed Jobs (7d): ${data.failedJobs}\n\nAdmin: ${this.frontendUrl()}/admin`,
      });
    } catch (err) {
      this.logger.error(`Failed to send daily ops report: ${err}`);
    }
  }

  // ── Sequence Emails (fired by EmailSequenceProcessor) ──

  // B2: Data submission reminder (bilingual)
  async sendDataSubmissionReminder(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] B2 data reminder: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          'Siguiente paso: enviar sus datos de balance / Next step: submit your data — CERNIQ',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Su portal CERNIQ esta configurado y listo. El siguiente paso es enviar los datos de su balance general para que podamos generar su informe ALM personalizado.</p>
           <p>El proceso toma menos de 10 minutos — solo necesita subir un archivo CSV con sus posiciones de activos y pasivos. La plantilla esta disponible en su portal.</p>
           <p>Si necesita ayuda con el formato, respondame directamente y le asisto.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Your CERNIQ portal is set up and ready. The next step is to submit your balance sheet data so we can generate your customized ALM report.</p>
           <p>The process takes less than 10 minutes — you just need to upload a CSV file with your asset and liability positions. The template is available in your portal.</p>
           <p>If you need help with the format, reply directly and I'll assist you.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/portal/submit?createCycle=1`,
          'Enviar datos ahora / Submit data now',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send B2: ${err}`);
    }
  }

  // B3: Onboarding check-in (bilingual)
  async sendOnboardingCheckIn(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] B3 check-in: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          'Necesita ayuda con sus datos? / Need help with your data? — CERNIQ',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Queria verificar personalmente si necesita ayuda para preparar sus datos de balance. Puedo asistirle con:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Formato del archivo CSV y mapeo de columnas</li>
             <li>Clasificacion de posiciones de activos y pasivos</li>
             <li>Cualquier duda sobre los datos requeridos</li>
           </ul>
           <p>Responda a este correo directamente y le ayudo — no tiene que buscar soporte en ningun otro lado.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>I wanted to personally check in to see if you need help preparing your balance sheet data. I can assist you with:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>CSV file format and column mapping</li>
             <li>Classification of asset and liability positions</li>
             <li>Any questions about the required data</li>
           </ul>
           <p>Reply to this email directly and I'll help — no need to look for support anywhere else.</p>
           ${this.SIGNATURE_EN}`,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send B3: ${err}`);
    }
  }

  // C2: Report follow-up (bilingual)
  async sendReportFollowUp(data: {
    email: string;
    name: string;
    institutionName: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] C2 report follow-up: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Guia rapida: como usar su informe ALM — ${data.institutionName} / Quick guide — CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Ahora que tiene su informe ALM de <strong>${data.institutionName}</strong>, le comparto como aprovecharlo al maximo:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Resumen Ejecutivo</strong> — comparta con su junta directiva para informar decisiones estrategicas</li>
             <li><strong>Sensibilidad NII</strong> — identifique su exposicion a cambios de tasa y planifique mitigaciones</li>
             <li><strong>Cumplimiento COSSEC</strong> — use como documentacion para examenes regulatorios</li>
             <li><strong>Recomendaciones</strong> — pasos concretos para fortalecer su posicion de riesgo</li>
           </ol>
           <p>Quiere una sesion de 15 minutos para revisar los resultados juntos? Responda a este correo y coordinamos.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Now that you have your ALM report for <strong>${data.institutionName}</strong>, here is how to get the most out of it:</p>
           <ol style="color: #334155; line-height: 2;">
             <li><strong>Executive Summary</strong> — share with your board to inform strategic decisions</li>
             <li><strong>NII Sensitivity</strong> — identify your rate exposure and plan mitigations</li>
             <li><strong>COSSEC Compliance</strong> — use as documentation for regulatory examinations</li>
             <li><strong>Recommendations</strong> — concrete steps to strengthen your risk position</li>
           </ol>
           <p>Would you like a 15-minute session to review the results together? Reply to this email and we'll coordinate.</p>
           ${this.SIGNATURE_EN}`,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send C2: ${err}`);
    }
  }

  // D5: Win-back (bilingual)
  async sendWinBackEmail(data: { email: string; name: string }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] D5 win-back: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject:
          'Le extranamos — novedades en CERNIQ / We miss you — CERNIQ updates',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Han pasado unos meses desde que cancelo su suscripcion. Queria escribirle personalmente porque hemos anadido mejoras significativas:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Informes bilingues mejorados (ES + EN) con mas detalle regulatorio</li>
             <li>Nuevos escenarios de estres alineados con requisitos COSSEC</li>
             <li>Portal de cliente rediseado con seguimiento en tiempo real</li>
           </ul>
           <p>Si desea regresar, respondame a este correo y le ofrezco condiciones especiales.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>It's been a few months since you cancelled your subscription. I wanted to write personally because we've added significant improvements:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Enhanced bilingual reports (ES + EN) with more regulatory detail</li>
             <li>New stress scenarios aligned with COSSEC requirements</li>
             <li>Redesigned client portal with real-time tracking</li>
           </ul>
           <p>If you'd like to come back, reply to this email and I'll offer special terms.</p>
           ${this.SIGNATURE_EN}`,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send D5: ${err}`);
    }
  }

  // A1: Lead nurture teaser (bilingual)
  async sendLeadNurtureTeaser(data: {
    email: string;
    name: string;
    institutionName: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] A1 lead teaser: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Vista previa: analisis ALM de ${data.institutionName} / ALM Preview — CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Estamos preparando su analisis ALM gratuito para <strong>${data.institutionName}</strong>. Pronto recibira un informe que incluye:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Brecha de duracion y perfil de riesgo de tasa</li>
             <li>Sensibilidad de ingreso neto por interes (NII)</li>
             <li>Evaluacion de cumplimiento COSSEC</li>
           </ul>
           <p>Mientras tanto, puede explorar nuestro demo interactivo para ver el tipo de analisis que recibira.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>We're preparing your free ALM analysis for <strong>${data.institutionName}</strong>. You'll soon receive a report that includes:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Duration gap and interest rate risk profile</li>
             <li>Net interest income (NII) sensitivity</li>
             <li>COSSEC compliance assessment</li>
           </ul>
           <p>In the meantime, you can explore our interactive demo to see the type of analysis you'll receive.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/demo`,
          'Ver demo / View demo',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send A1: ${err}`);
    }
  }

  // A2: Lead nurture pricing (bilingual)
  async sendLeadNurturePricing(data: {
    email: string;
    name: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] A2 pricing: ${data.email}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: 'Planes y precios — CERNIQ ALM / Plans & pricing',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>CERNIQ ofrece inteligencia de riesgo institucional a una fraccion del costo de consultores tradicionales:</p>
           <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
             <tr style="border-bottom: 1px solid #E5E7EB;">
               <td style="padding: 10px; font-weight: bold;">Informe Piloto</td>
               <td style="padding: 10px;">$750</td>
               <td style="padding: 10px; color: #6B7280;">Un informe bilingue de 14+ paginas</td>
             </tr>
             <tr style="border-bottom: 1px solid #E5E7EB;">
               <td style="padding: 10px; font-weight: bold;">Piloto (90 dias)</td>
               <td style="padding: 10px;">$2,500/mes</td>
               <td style="padding: 10px; color: #6B7280;">Plataforma completa + analista IA</td>
             </tr>
             <tr>
               <td style="padding: 10px; font-weight: bold;">Anual</td>
               <td style="padding: 10px;">$3,500/mes</td>
               <td style="padding: 10px; color: #6B7280;">Contrato anual, usuarios ilimitados</td>
             </tr>
           </table>
           <p>Respondame a este correo si desea discutir cual plan es mejor para su institucion.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>CERNIQ offers institutional risk intelligence at a fraction of the cost of traditional consultants:</p>
           <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
             <tr style="border-bottom: 1px solid #E5E7EB;">
               <td style="padding: 10px; font-weight: bold;">Pilot Report</td>
               <td style="padding: 10px;">$750</td>
               <td style="padding: 10px; color: #6B7280;">One 14+ page bilingual report</td>
             </tr>
             <tr style="border-bottom: 1px solid #E5E7EB;">
               <td style="padding: 10px; font-weight: bold;">Pilot (90-day)</td>
               <td style="padding: 10px;">$2,500/mo</td>
               <td style="padding: 10px; color: #6B7280;">Full platform + AI analyst</td>
             </tr>
             <tr>
               <td style="padding: 10px; font-weight: bold;">Annual</td>
               <td style="padding: 10px;">$3,500/mo</td>
               <td style="padding: 10px; color: #6B7280;">Annual contract, unlimited users</td>
             </tr>
           </table>
           <p>Reply to this email if you'd like to discuss which plan is best for your institution.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/pricing`,
          'Ver planes / View plans',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send A2: ${err}`);
    }
  }

  // ── Renewal Reminder (bilingual) ─────────────────────

  async sendRenewalReminder(data: {
    email: string;
    name: string;
    daysLeft: number;
    tier: string;
    currentPeriodEnd: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(
        `[DRY RUN] Renewal reminder (D-${data.daysLeft}): ${data.email}`,
      );
      return;
    }
    try {
      const isUrgent = data.daysLeft <= 7;
      const subject = isUrgent
        ? `Accion requerida: su suscripcion vence en ${data.daysLeft} dias / Action required — CERNIQ`
        : `Su suscripcion se renueva en ${data.daysLeft} dias / Renewal reminder — CERNIQ`;

      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Su suscripcion <strong>${data.tier}</strong> de CERNIQ ${isUrgent ? 'vence' : 'se renueva'} el <strong>${data.currentPeriodEnd}</strong> (en ${data.daysLeft} dias).</p>
           ${data.daysLeft <= 14 ? `<p>Para asegurar continuidad de servicio y acceso a sus informes ALM, verifique que su metodo de pago este al dia.</p>` : ''}
           ${data.daysLeft <= 14 ? `<p>Si desea explorar un plan superior con reportes ilimitados y alertas en tiempo real, respondame directamente.</p>` : ''}
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Your CERNIQ <strong>${data.tier}</strong> subscription ${isUrgent ? 'expires' : 'renews'} on <strong>${data.currentPeriodEnd}</strong> (in ${data.daysLeft} days).</p>
           ${data.daysLeft <= 14 ? `<p>To ensure uninterrupted service and access to your ALM reports, please verify your payment method is up to date.</p>` : ''}
           ${data.daysLeft <= 14 ? `<p>If you'd like to explore an upgraded plan with unlimited reports and real-time alerts, reply directly.</p>` : ''}
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/portal/billing`,
          'Ver facturacion / View billing',
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send renewal reminder: ${err}`);
    }
  }

  // ── Churn Risk Alert (internal, to operator inbox) ───────────

  async sendChurnRiskAlert(data: {
    userName: string;
    userEmail: string;
    tier: string;
    daysSinceLogin: number;
    currentPeriodEnd: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Churn risk alert: ${data.userEmail}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `CHURN RISK: ${data.userName || data.userEmail} — ${data.daysSinceLogin}d inactive`,
        text: `Churn risk detected.\n\nUser: ${data.userName || '—'}\nEmail: ${data.userEmail}\nTier: ${data.tier}\nDays since login: ${data.daysSinceLogin}\nRenewal date: ${data.currentPeriodEnd}\n\nConsider reaching out personally.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send churn risk alert: ${err}`);
    }
  }

  // ── Weekly Revenue Report (internal, to operator inbox) ──────

  async sendWeeklyRevenueReport(data: {
    activeBytier: Record<string, number>;
    totalActive: number;
    newThisWeek: number;
    cancelledThisWeek: number;
    upcomingRenewals: { email: string; tier: string; renewsAt: string }[];
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Weekly revenue report`);
      return;
    }
    try {
      const tierLines = Object.entries(data.activeBytier)
        .map(([tier, count]) => `  ${tier}: ${count}`)
        .join('\n');
      const renewalLines =
        data.upcomingRenewals.length > 0
          ? data.upcomingRenewals
              .map((r) => `  ${r.email} (${r.tier}) — ${r.renewsAt}`)
              .join('\n')
          : '  None';

      await this.resend.emails.send({
        from: this.alertFrom(),
        to: this.requireAdminEmail(),
        subject: `Weekly Revenue: ${data.totalActive} active | +${data.newThisWeek} new | -${data.cancelledThisWeek} cancelled`,
        text: `Weekly Revenue Report\n\nActive Subscriptions: ${data.totalActive}\n\nBy Tier:\n${tierLines}\n\nNew This Week: ${data.newThisWeek}\nCancelled This Week: ${data.cancelledThisWeek}\n\nUpcoming Renewals (30d):\n${renewalLines}\n\nAdmin: ${this.frontendUrl()}/admin`,
      });
    } catch (err) {
      this.logger.error(`Failed to send weekly revenue report: ${err}`);
    }
  }

  // ── NPS Survey (bilingual) ──────────────────────────

  async sendNPSSurvey(data: {
    email: string;
    name: string;
    institutionName: string;
    jobId: string;
    institutionId: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] NPS survey: ${data.email}`);
      return;
    }
    try {
      const baseUrl = (process.env.BACKEND_URL || 'https://api.example.com')
        .trim()
        .replace(/\/+$/, '');
      const scoreLinks = Array.from({ length: 11 }, (_, i) => {
        const url = `${baseUrl}/api/feedback/nps?score=${i}&jobId=${data.jobId}&institutionId=${data.institutionId}`;
        const color = i <= 6 ? '#DC2626' : i <= 8 ? '#D97706' : '#16A34A';
        return `<a href="${url}" style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;background:${color};color:#FFFFFF;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;margin:2px;">${i}</a>`;
      }).join('');

      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `Como fue su experiencia? — ${data.institutionName} / How was your experience? — CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Su informe ALM de <strong>${data.institutionName}</strong> fue entregado recientemente. Me encantaria saber que tan probable es que recomiende CERNIQ a un colega.</p>
           <p style="text-align:center;margin:24px 0 8px;"><strong>Del 0 al 10, que tan probable es que recomiende CERNIQ?</strong></p>
           <div style="text-align:center;margin:8px 0 24px;">${scoreLinks}</div>
           <p style="text-align:center;font-size:12px;color:#94A3B8;">0 = Nada probable &nbsp;&nbsp; 10 = Muy probable</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Your ALM report for <strong>${data.institutionName}</strong> was recently delivered. I'd love to know how likely you are to recommend CERNIQ to a colleague.</p>
           <p style="text-align:center;margin:24px 0 8px;"><strong>On a scale of 0-10, how likely are you to recommend CERNIQ?</strong></p>
           <div style="text-align:center;margin:8px 0 24px;">${scoreLinks}</div>
           <p style="text-align:center;font-size:12px;color:#94A3B8;">0 = Not at all likely &nbsp;&nbsp; 10 = Very likely</p>
           ${this.SIGNATURE_EN}`,
        ),
      });
    } catch (err) {
      this.logger.error(`Failed to send NPS survey: ${err}`);
    }
  }

  // ── Team Invite (bilingual) ──────────────────────────

  async sendTeamInviteEmail(data: {
    email: string;
    name: string;
    inviterName: string;
    role: string;
    magicUrl: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Team invite: ${data.email} as ${data.role}`);
      return;
    }

    const roleLabel: Record<string, string> = {
      OWNER: 'Propietario / Owner',
      ANALYST: 'Analista / Analyst',
      VIEWER: 'Visor / Viewer',
    };

    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: `${data.inviterName} le ha invitado a CERNIQ / You've been invited to CERNIQ`,
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p><strong>${data.inviterName}</strong> le ha invitado a unirse a su equipo en CERNIQ como <strong>${roleLabel[data.role] || data.role}</strong>.</p>
           <p>Haga clic en el boton de abajo para acceder a su cuenta. Este enlace es valido por 72 horas.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p><strong>${data.inviterName}</strong> has invited you to join their team on CERNIQ as <strong>${roleLabel[data.role] || data.role}</strong>.</p>
           <p>Click the button below to access your account. This link is valid for 72 hours.</p>
           ${this.SIGNATURE_EN}`,
          data.magicUrl,
          'Acceder a CERNIQ / Access CERNIQ',
        ),
      });
      this.logger.log(`Team invite sent to ${data.email} as ${data.role}`);
    } catch (err) {
      this.logger.error(`Failed to send team invite: ${err}`);
    }
  }

  // ── Raw Email (for outreach & ad-hoc sends) ───────────

  async sendRawEmail(data: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[DRY RUN] Raw email to: ${data.to} — ${data.subject}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.to,
        subject: data.subject,
        html: this.wrap(data.html),
      });
      this.logger.log(`Raw email sent to ${data.to}: ${data.subject}`);
    } catch (err) {
      this.logger.error(`Failed to send raw email to ${data.to}: ${err}`);
      throw err;
    }
  }

  // ── Demo Confirmation (bilingual) ─────────────────────

  async sendDemoConfirmation(data: {
    name?: string;
    email: string;
  }): Promise<void> {
    if (!this.resend) return;

    try {
      await this.resend.emails.send({
        from: this.senderFrom(),
        replyTo: this.adminEmail(),
        to: data.email,
        subject: 'Su demo de CERNIQ esta listo / Your CERNIQ demo is ready',
        html: this.wrap(
          `<p>Hola ${data.name || ''},</p>
           <p>Gracias por su interes en CERNIQ. He preparado un demo personalizado para usted con el perfil de un banco comunitario de Puerto Rico ($1.2B en activos).</p>
           <p>En el demo podra ver:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Analisis de brecha de duracion para el balance del banco</li>
             <li>Sensibilidad NII a escenarios de +/-300bps</li>
             <li>Prueba de estres Monte Carlo (1,000 trayectorias, 4 escenarios regulatorios)</li>
             <li>Generacion de PDF con un clic para junta directiva y examinadores</li>
           </ul>
           <p>Me comunicare dentro de 24 horas para coordinar una sesion de 20 minutos donde le muestro todo en detalle.</p>
           ${this.SIGNATURE_ES}

           ${this.DIVIDER}

           <p>Hi ${data.name || ''},</p>
           <p>Thanks for your interest in CERNIQ. I've set up a personalized demo for you with a $1.2B Puerto Rico community bank profile.</p>
           <p>In the demo you'll see:</p>
           <ul style="color: #334155; line-height: 2;">
             <li>Duration gap analysis for the bank's balance sheet</li>
             <li>NII sensitivity across +/-300bps rate scenarios</li>
             <li>Monte Carlo stress test (1,000 paths, 4 regulatory scenarios)</li>
             <li>One-click PDF report for your board and examiners</li>
           </ul>
           <p>I'll reach out within 24 hours to schedule a 20-minute walkthrough.</p>
           ${this.SIGNATURE_EN}`,
          `${this.frontendUrl()}/demo?type=bank`,
          'Abrir demo / Open demo',
        ),
      });
      this.logger.log(`Demo confirmation sent to ${data.email}`);
    } catch (err) {
      this.logger.error(`Failed to send demo confirmation: ${err}`);
    }
  }
}
