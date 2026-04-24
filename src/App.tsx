import { BrowserRouter, Route, Routes } from "react-router-dom";
import Menu from "@/pages/Menu";
import V1 from "@/explorations/v1_plaster";
import V2 from "@/explorations/v2_data_art";
import V3 from "@/explorations/v3_obsidian_gold";
import V4 from "@/explorations/v4_synthwave";
import V5 from "@/explorations/v5_paper_cutout";
import V6 from "@/explorations/v6_shanshui";
import V7 from "@/explorations/v7_blueprint";
import V8 from "@/explorations/v8_thermal";
import V9 from "@/explorations/v9_ethereal";
import V10 from "@/explorations/v10_liquid_chrome";
import V11 from "@/explorations/v11_unified_map";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Menu />} />
        <Route path="/v1" element={<V1 />} />
        <Route path="/v2" element={<V2 />} />
        <Route path="/v3" element={<V3 />} />
        <Route path="/v4" element={<V4 />} />
        <Route path="/v5" element={<V5 />} />
        <Route path="/v6" element={<V6 />} />
        <Route path="/v7" element={<V7 />} />
        <Route path="/v8" element={<V8 />} />
        <Route path="/v9" element={<V9 />} />
        <Route path="/v10" element={<V10 />} />
        <Route path="/v10/:slug" element={<V10 />} />
        <Route path="/v11" element={<V11 />} />
      </Routes>
    </BrowserRouter>
  );
}
