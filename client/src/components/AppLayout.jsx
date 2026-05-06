import FooterCarousel from "./FooterCarousel.jsx";

const TABS = [
  { id: "ranking", label: "Ranking" },
  { id: "activity", label: "Actividad" },
  { id: "users", label: "Usuarios" },
  { id: "admin", label: "Admin" },
  { id: "privacy", label: "Privacidad" },
  { id: "info", label: "Informacion" },
];

export default function AppLayout({ onTabChange, activeTab, children }) {
  return (
    <>
      <header className="app-header">
        <div className="app-brand" aria-label="Tullidos SoloQ Ladder">
          <span className="app-brand__title">Tullidos</span>
          <span className="app-brand__subtitle">SoloQ Ladder</span>
        </div>

        <nav className="app-nav" aria-label="Secciones principales">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`app-nav__item ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => onTabChange(tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="page-content">{children}</div>
      {! ["users", "admin"].includes(activeTab) && <FooterCarousel />}
    </>
  );
}
