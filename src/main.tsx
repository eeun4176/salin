import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { router } from "@/app/router";

import { initializeDatabase } from "@/core/storage/database";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

initializeDatabase()
  .then(() => console.info("SALIN AI database initialized"))
  .catch((error) => console.error("Database initialization failed:", error));