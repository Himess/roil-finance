import { Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import Landing from '@/pages/Landing';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import SignUp from '@/pages/SignUp';
import ChooseStrategy from '@/pages/ChooseStrategy';
import PickTemplate from '@/pages/PickTemplate';
import BuildYourOwn from '@/pages/BuildYourOwn';
import DCA from '@/pages/DCA';
import NewDCA from '@/pages/NewDCA';
import Rewards from '@/pages/Rewards';
import Settings from '@/pages/Settings';
import History from '@/pages/History';
import Portfolio from '@/pages/Portfolio';
import Slides from '@/pages/Slides';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { PartyProvider } from '@/context/PartyContext';

function ReferralRedirect() {
  const { code } = useParams();
  if (code) localStorage.setItem('referralCode', code);
  return <Navigate to="/app/rewards" replace />;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-4xl font-bold text-ink mb-2">404</h1>
      <p className="text-ink-secondary mb-6">Page not found</p>
      <Link to="/app" className="btn-primary">
        Return to Dashboard
      </Link>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <AppLayout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/create" element={<ChooseStrategy />} />
          <Route path="/create/templates" element={<PickTemplate />} />
          <Route path="/create/build" element={<BuildYourOwn />} />
          <Route path="/dca" element={<DCA />} />
          <Route path="/dca/new" element={<NewDCA />} />
          <Route path="/rewards" element={<Rewards />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/history" element={<History />} />
          <Route path="/ref/:code" element={<ReferralRedirect />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </AppLayout>
  );
}

export default function App() {
  return (
    <PartyProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/slides" element={<Slides />} />
          <Route path="/app/*" element={<AuthenticatedApp />} />
        </Routes>
      </ToastProvider>
    </PartyProvider>
  );
}
