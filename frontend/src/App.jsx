import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import { ToastContainer } from './components/Toast';

export default function App() {
  return (
    <div className="app-layout">
      <Header />
      <Dashboard />
      <ToastContainer />
    </div>
  );
}
