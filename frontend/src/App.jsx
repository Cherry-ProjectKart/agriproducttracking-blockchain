import AppHeader from './components/AppHeader.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppHeader title="Blockchain Product Tracking" />
      <main id="main-content" className="app-main">
        <DashboardPage />
      </main>
      <footer className="app-footer">
        <p>Foundation build · BPT-001</p>
      </footer>
    </div>
  );
}
