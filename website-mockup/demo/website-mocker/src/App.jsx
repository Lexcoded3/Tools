import React, { useState } from "react";
import Device from "react-device-frame";

function WebsitePreview({ url, websiteContent }) {
  return (
    <div className="device-perspectives">
      {websiteContent && (
        <>
          <div style={{ transform: "scale(0.3)", transformOrigin: "195% 35%" }}>
            <Device name="iphone-x" url={url} site={websiteContent} portrait />
          </div>
          <div style={{ transform: "scale(0.6)", transformOrigin: "70% 0%" }}>
            <Device name="macbook-pro" url={url} site={websiteContent} portrait />
          </div>
          <div style={{ transform: "scale(0.35)", transformOrigin: "-45% 25%" }}>
            <Device name="ipad-mini" url={url} site={websiteContent} portrait />
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [websiteContent, setWebsiteContent] = useState(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const backendUrl = import.meta.env.VITE_BACKEND_URL

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(
        `${backendUrl}/preview?url=${encodeURIComponent(websiteUrl)}`,
        { method: "GET" }
      );
      const html = await response.text();
      setWebsiteContent(html);
    } catch (error) {
      console.error("Error fetching website content:", error);
      // Optionally, you can set an error state here to display to the user
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="searchbox-wrap">
        <input
          type="text"
          placeholder="eg: http://localhost:5173"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
        />
        <button type="submit">
          <span>Preview</span>
        </button>
      </form>
      <WebsitePreview websiteContent={websiteContent} url={websiteUrl} />
    </div>
  );
}

export default App;
