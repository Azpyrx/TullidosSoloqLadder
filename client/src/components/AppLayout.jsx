import StaggeredMenu from "./StaggeredMenu.jsx";
import FooterCarousel from "./FooterCarousel.jsx";

const TABS = [
  { id: "ranking", label: "Ranking" },
  { id: "users", label: "Usuarios" },
  { id: "info", label: "Informacion" },
];

export default function AppLayout({ onTabChange, activeTab, children }) {
  const items = TABS.map((tab) => ({
    label: tab.label,
    link: "#",
    ariaLabel: tab.label,
    onClick: () => onTabChange(tab.id),
  }));

  return (
    <>
      <StaggeredMenu
        isFixed
        items={items}
        colors={["#2b6a4f", "#b6893f"]}
        accentColor="#b6893f"
        menuButtonColor="#e8eaed"
        openMenuButtonColor="#fff"
        displaySocials={false}
        displayItemNumbering
        logoAlt="Tullidos"
      />
      <div className="page-content">{children}</div>
      {activeTab !== "users" && <FooterCarousel />}
    </>
  );
}