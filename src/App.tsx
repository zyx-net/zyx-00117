import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import MainLayout from "@/components/MainLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import RegisterSamples from "@/pages/RegisterSamples";
import BatchDetail from "@/pages/BatchDetail";
import BatchList from "@/pages/BatchList";
import SampleList from "@/pages/SampleList";
import SampleDetail from "@/pages/SampleDetail";
import AuditLog from "@/pages/AuditLog";
import UserList from "@/pages/UserList";
import QuickAction from "@/pages/QuickAction";
import { useAppStore } from "@/store";

function AppRoutes() {
  const init = useAppStore((s) => s.init);
  useEffect(() => { init(); }, [init]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<MainLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/register" element={<RegisterSamples />} />
        <Route path="/handover" element={<QuickAction mode="handover" />} />
        <Route path="/receive" element={<QuickAction mode="receive" />} />
        <Route path="/return" element={<QuickAction mode="return" />} />
        <Route path="/batches" element={<BatchList />} />
        <Route path="/batches/:id" element={<BatchDetail />} />
        <Route path="/samples" element={<SampleList />} />
        <Route path="/samples/:id" element={<SampleDetail />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/users" element={<UserList />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
