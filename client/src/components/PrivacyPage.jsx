export default function PrivacyPage() {
  const updatedAt = "13/03/2026";

  return (
    <section className="privacy-page">
      <header className="privacy-hero">
        <p className="privacy-kicker">Privacidad y RGPD</p>
        <h2>Politica de Privacidad</h2>
        <p>
          Esta politica explica como tratamos datos personales en SoloQ Ladder.
          El objetivo es ser claros: que recogemos, por que, durante cuanto tiempo y
          que derechos tienes segun RGPD y LOPDGDD.
        </p>
        <p className="privacy-updated">Ultima actualizacion: {updatedAt}</p>
      </header>

      <article className="privacy-card privacy-card--toc">
        <h3>Indice rapido</h3>
        <ol className="privacy-toc">
          <li>Quien es el responsable</li>
          <li>Principios de tratamiento</li>
          <li>Como recogemos datos</li>
          <li>Que datos tratamos</li>
          <li>Cuando recogemos datos</li>
          <li>Base juridica y finalidades</li>
          <li>Destinatarios</li>
          <li>Conservacion</li>
          <li>Cookies y tecnologias similares</li>
          <li>Tus derechos</li>
          <li>Retirada de consentimiento</li>
          <li>Seguridad</li>
          <li>Enlaces externos</li>
          <li>Cambios de esta politica</li>
          <li>Contacto</li>
          <li>Publicidad y terceros</li>
        </ol>
      </article>

      <article className="privacy-card">
        <h3>1. Quien es el responsable</h3>
        <p>
          Responsable del tratamiento: administracion de SoloQ Ladder.
          Si tienes dudas sobre privacidad o quieres ejercer derechos, usa el contacto indicado
          en la seccion 15.
        </p>
      </article>

      <article className="privacy-card">
        <h3>2. Principios de tratamiento</h3>
        <ul>
          <li>Licitud, lealtad y transparencia.</li>
          <li>Minimizacion: recogemos solo datos necesarios para la finalidad declarada.</li>
          <li>Limitacion de la finalidad: no usamos datos para fines incompatibles.</li>
          <li>Exactitud y actualizacion de los datos cuando aplica.</li>
          <li>Integridad y confidencialidad mediante medidas tecnicas y organizativas.</li>
          <li>Privacidad desde el diseno y por defecto.</li>
        </ul>
      </article>

      <article className="privacy-card">
        <h3>3. Como recogemos datos</h3>
        <p>
          Recogemos datos por tres vias: informacion tecnica del navegador, eventos de uso de la
          web y datos enviados de forma directa por el usuario en formularios o acciones del panel.
        </p>
      </article>

      <article className="privacy-card">
        <h3>4. Que datos tratamos</h3>
        <ul>
          <li>Pagina visitada y fecha/hora de visita.</li>
          <li>Pais y ciudad aproximados cuando el proveedor de red los facilita.</li>
          <li>Origen de visita, idioma, zona horaria y resolucion de pantalla.</li>
          <li>IP anonimizada (se enmascara y no se guarda IP completa).</li>
          <li>Identificadores tecnicos del navegador (user-agent).</li>
        </ul>
      </article>

      <article className="privacy-card">
        <h3>5. Cuando recogemos datos</h3>
        <p>
          Se recogen eventos al navegar por la web y cambiar de secciones.
          Las metricas de analitica solo se guardan cuando existe consentimiento previo.
        </p>
      </article>

      <article className="privacy-card">
        <h3>6. Base juridica y finalidades</h3>
        <p>
          Finalidad principal: analitica basica de uso para mejorar rendimiento y usabilidad.
          Base juridica principal: consentimiento (art. 6.1.a RGPD) para analitica no esencial.
          Tambien podemos tratar datos por interes legitimo (art. 6.1.f RGPD) para seguridad,
          prevencion de abuso y continuidad tecnica del servicio.
        </p>
      </article>

      <article className="privacy-card">
        <h3>7. Destinatarios</h3>
        <p>
          Acceden a los datos solo personas autorizadas y proveedores necesarios para operar el
          servicio (hosting, infraestructura, seguridad y monitorizacion), siempre bajo contrato
          y con obligaciones de confidencialidad.
        </p>
      </article>

      <article className="privacy-card">
        <h3>8. Conservacion</h3>
        <p>
          Conservamos datos durante el tiempo necesario para cada finalidad.
          El sistema mantiene historiales limitados y elimina eventos antiguos automaticamente.
        </p>
        <div className="privacy-retention">
          <div className="privacy-retention__row privacy-retention__row--head">
            <span>Categoria</span>
            <span>Plazo orientativo</span>
          </div>
          <div className="privacy-retention__row">
            <span>Eventos de analitica anonimizados</span>
            <span>Hasta limite tecnico del historial</span>
          </div>
          <div className="privacy-retention__row">
            <span>Logs tecnicos y seguridad</span>
            <span>Periodo minimo necesario</span>
          </div>
          <div className="privacy-retention__row">
            <span>Solicitudes de derechos</span>
            <span>Mientras exista obligacion legal de evidencia</span>
          </div>
        </div>
      </article>

      <article className="privacy-card">
        <h3>9. Cookies y tecnologias similares</h3>
        <p>
          Utilizamos tecnologias de almacenamiento local y mecanismos equivalentes.
          Puedes aceptar o rechazar las metricas no esenciales desde el banner de consentimiento.
          Si bloqueas elementos tecnicos esenciales, algunas funciones pueden dejar de funcionar.
        </p>
      </article>

      <article className="privacy-card">
        <h3>10. Tus derechos</h3>
        <ul>
          <li>Acceso a tus datos.</li>
          <li>Rectificacion de datos inexactos.</li>
          <li>Supresion cuando proceda.</li>
          <li>Limitacion del tratamiento.</li>
          <li>Oposicion al tratamiento.</li>
          <li>Portabilidad cuando sea aplicable.</li>
          <li>Reclamacion ante la AEPD.</li>
        </ul>
      </article>

      <article className="privacy-card">
        <h3>11. Retirada de consentimiento</h3>
        <p>
          Puedes retirar el consentimiento en cualquier momento. La retirada no afecta a la
          licitud del tratamiento realizado antes de retirarlo.
        </p>
      </article>

      <article className="privacy-card">
        <h3>12. Seguridad</h3>
        <p>
          Aplicamos medidas tecnicas y organizativas razonables para evitar acceso no autorizado,
          perdida, alteracion o divulgacion indebida de datos.
        </p>
      </article>

      <article className="privacy-card">
        <h3>13. Enlaces externos</h3>
        <p>
          Esta web puede contener enlaces a servicios de terceros.
          Cada tercero tiene su propia politica de privacidad y condiciones.
        </p>
      </article>

      <article className="privacy-card">
        <h3>14. Cambios de esta politica</h3>
        <p>
          Podemos actualizar esta politica cuando cambie la normativa o el funcionamiento del
          servicio. Recomendamos revisarla periodicamente.
        </p>
      </article>

      <article className="privacy-card">
        <h3>15. Contacto</h3>
        <p>
          Para solicitudes de privacidad, ejercicio de derechos o dudas legales, escribe a:
          <strong> Azpy </strong> en discord,
          o usa el canal de contacto que aparezca en la web.
        </p>
      </article>

      <article className="privacy-card">
        <h3>16. Publicidad y terceros</h3>
        <p>
          Si en el futuro se incorporan redes publicitarias o herramientas externas,
          esta seccion se actualizara con su identidad, finalidad, base juridica y forma de exclusion.
          Actualmente no vendemos datos personales.
        </p>
      </article>
    </section>
  );
}
