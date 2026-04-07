import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api";
import FormDashboard from "./pages/FormDashboard";
import FormEditor from "./pages/FormEditor";
import FormList from "./pages/FormList";
import FirewallPage from "./pages/FirewallPage";
import Login from "./pages/Login";
import PublicForm from "./pages/PublicForm";
import UsersPage from "./pages/UsersPage";

function Protected({ element }: { element: JSX.Element }) {
  return getToken() ? element : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/f/:slug" element={<PublicForm />} />
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected element={<FormList />} />} />
      <Route path="/forms/:id/edit" element={<Protected element={<FormEditor />} />} />
      <Route path="/forms/:id/dashboard" element={<Protected element={<FormDashboard />} />} />
      <Route path="/users" element={<Protected element={<UsersPage />} />} />
      <Route path="/firewall" element={<Protected element={<FirewallPage />} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
