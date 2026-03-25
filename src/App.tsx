import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthGuard } from './components/AuthGuard';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProductList from './pages/ProductList';
import ProductDetail from './pages/ProductDetail';
import AddEditProduct from './pages/AddEditProduct';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import ScanPage from './pages/ScanPage';

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <AuthGuard>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/products"
              element={
                <AuthGuard>
                  <Layout>
                    <ProductList />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/products/:id"
              element={
                <AuthGuard>
                  <Layout>
                    <ProductDetail />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/products/add"
              element={
                <AuthGuard requiredRole="admin">
                  <Layout>
                    <AddEditProduct />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/products/edit/:id"
              element={
                <AuthGuard requiredRole="admin">
                  <Layout>
                    <AddEditProduct />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/alerts"
              element={
                <AuthGuard>
                  <Layout>
                    <Alerts />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/settings"
              element={
                <AuthGuard requiredRole="admin">
                  <Layout>
                    <Settings />
                  </Layout>
                </AuthGuard>
              }
            />
            <Route
              path="/scan"
              element={
                <AuthGuard>
                  <ScanPage />
                </AuthGuard>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
