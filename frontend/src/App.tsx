import { Navigate, Route, Routes } from "react-router-dom";
import FormDashboard from "./pages/FormDashboard";
import FormEditor from "./pages/FormEditor";
import FormList from "./pages/FormList";
import Login from "./pages/Login";
import PublicForm from "./pages/PublicForm";
import Register from "./pages/Register";

export default function App() {
  return (
    <Routes>
      <Route path="/f/:slug" element={<PublicForm />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<FormList />} />
      <Route path="/forms/:id/edit" element={<FormEditor />} />
      <Route path="/forms/:id/dashboard" element={<FormDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
