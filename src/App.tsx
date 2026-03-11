import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Settings, Palette, Image as ImageIcon, Loader2, MousePointer2, RefreshCw, Link } from 'lucide-react';

declare global {
  interface Window {
    ImageTracer: any;
  }
}

// Helper to convert rgb() or rgba() to hex
const rgbToHex = (color: string) => {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color;
  
  // Handle rgb and rgba
  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#000000';
  
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
};

// Helper to resize large images before tracing to avoid browser freeze
const resizeImage = (dataUrl: string, maxSize: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      reject(new Error("Failed to load image. The file might be corrupted or not a valid image."));
    };
    img.src = dataUrl;
  });
};

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [svgString, setSvgString] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>('#000000');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  
  const [settings, setSettings] = useState({
    numberofcolors: 17,
    ltres: 1.0,
    qtres: 1.0,
    pathomit: 8,
    blurradius: 0,
    colorSampling: 'deterministic'
  });

  const svgContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (PNG/JPG).');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      try {
        const resized = await resizeImage(result, 800); // Resize to max 800px for performance
        setImageSrc(resized);
        processImage(resized, settings);
      } catch (err) {
        alert('Failed to process image. Please ensure it is a valid image file.');
        console.error(err);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput) return;
    
    setIsLoadingUrl(true);
    try {
      let response;
      
      // Attempt 1: Direct fetch (works if server has CORS headers)
      try {
        response = await fetch(imageUrlInput);
      } catch (err) {
        // Attempt 2: Use corsproxy.io
        try {
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(imageUrlInput)}`;
          response = await fetch(proxyUrl);
        } catch (err2) {
          // Attempt 3: Use allorigins as fallback
          const proxyUrl2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrlInput)}`;
          response = await fetch(proxyUrl2);
        }
      }

      if (!response || !response.ok) throw new Error('Failed to fetch image');
      
      const blob = await response.blob();
      
      // Some proxies return generic octet-stream or text/plain for images.
      // If it's explicitly HTML or JSON, it's probably an error page.
      if (blob.type.includes('text/html') || blob.type.includes('application/json')) {
        throw new Error('URL returned an HTML page or JSON instead of an image.');
      }
      
      // Force a valid image type if the proxy stripped it, so `handleFile` accepts it.
      // The actual image validation will happen when `Image` tries to load it in `resizeImage`.
      let mimeType = blob.type;
      if (!mimeType || mimeType === 'application/octet-stream' || mimeType.includes('text/')) {
        mimeType = 'image/png';
      }
      
      const file = new File([blob], "image.png", { type: mimeType });
      handleFile(file);
    } catch (error) {
      alert('Could not load image from URL. It might be protected, invalid, or blocking CORS proxies.');
      console.error(error);
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const processImage = (dataUrl: string, currentSettings: typeof settings) => {
    if (!window.ImageTracer) {
      alert("ImageTracer library is still loading. Please try again in a moment.");
      return;
    }

    setIsProcessing(true);
    setSelectedPathId(null);

    // Use setTimeout to allow UI to render the loading state before blocking thread
    setTimeout(() => {
      window.ImageTracer.imageToSVG(
        dataUrl,
        (svgstr: string) => {
          // Parse the SVG string to add unique IDs to all paths
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgstr, 'image/svg+xml');
          const elements = doc.querySelectorAll('path, polygon, rect');
          elements.forEach((el, index) => {
            el.id = `svg-path-${index}`;
          });
          
          setSvgString(new XMLSerializer().serializeToString(doc));
          setIsProcessing(false);
        },
        {
          numberofcolors: currentSettings.numberofcolors,
          ltres: currentSettings.ltres,
          qtres: currentSettings.qtres,
          pathomit: currentSettings.pathomit,
          blurradius: currentSettings.blurradius,
          colorquantcycles: currentSettings.colorSampling === 'deterministic' ? 1 : 3,
          strokewidth: 1,
          linefilter: true,
          viewbox: true,
        }
      );
    }, 50);
  };

  const handleApplySettings = () => {
    if (imageSrc) {
      processImage(imageSrc, settings);
    }
  };

  // Ensure the selected path always has the selected class and is brought to front
  useEffect(() => {
    if (svgContainerRef.current) {
      // Remove from all first
      const allSelected = svgContainerRef.current.querySelectorAll('.selected');
      allSelected.forEach(el => el.classList.remove('selected'));
      
      // Add to the correct one
      if (selectedPathId) {
        const el = svgContainerRef.current.querySelector(`#${selectedPathId}`);
        if (el) {
          el.classList.add('selected');
          // Bring to front so the stroke isn't hidden by adjacent paths
          el.parentNode?.appendChild(el);
        }
      }
    }
  }, [selectedPathId, svgString]);

  const handleSvgClick = (e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    const tagName = target.tagName.toLowerCase();
    
    if (tagName === 'path' || tagName === 'polygon' || tagName === 'rect') {
      // Remove selection from previous
      if (selectedPathId && svgContainerRef.current) {
        const prev = svgContainerRef.current.querySelector(`#${selectedPathId}`);
        if (prev) prev.classList.remove('selected');
      }
      
      // Select new
      target.classList.add('selected');
      target.parentNode?.appendChild(target); // Bring to front immediately
      setSelectedPathId(target.id);
      
      // Extract color
      const fill = target.getAttribute('fill') || target.style.fill;
      if (fill && fill !== 'none') {
        setSelectedColor(rgbToHex(fill));
      } else {
        // If no fill, maybe it has a stroke
        const stroke = target.getAttribute('stroke') || target.style.stroke;
        if (stroke && stroke !== 'none') {
          setSelectedColor(rgbToHex(stroke));
        }
      }
    } else {
      // Deselect if clicking outside a path
      if (selectedPathId && svgContainerRef.current) {
        const prev = svgContainerRef.current.querySelector(`#${selectedPathId}`);
        if (prev) prev.classList.remove('selected');
        setSelectedPathId(null);
      }
    }
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setSelectedColor(newColor);
    
    if (selectedPathId && svgContainerRef.current) {
      const path = svgContainerRef.current.querySelector(`#${selectedPathId}`) as SVGElement;
      if (path) {
        // Update attribute
        path.setAttribute('fill', newColor);
        // Also update inline style just in case
        path.style.fill = newColor;
        
        if (path.hasAttribute('stroke') || path.style.stroke) {
          path.setAttribute('stroke', newColor);
          path.style.stroke = newColor;
        }
        
        // Sync to svgString so React doesn't overwrite it on re-render
        const svgElement = svgContainerRef.current.querySelector('svg');
        if (svgElement) {
          // Clone to avoid saving the 'selected' class
          const clone = svgElement.cloneNode(true) as SVGSVGElement;
          const selected = clone.querySelector('.selected');
          if (selected) selected.classList.remove('selected');
          setSvgString(new XMLSerializer().serializeToString(clone));
        }
      }
    }
  };

  const downloadSvg = () => {
    if (!svgContainerRef.current) return;
    const svgElement = svgContainerRef.current.querySelector('svg');
    if (!svgElement) return;

    // Clone to remove the 'selected' class before exporting
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    const selected = clone.querySelector('.selected');
    if (selected) {
      selected.classList.remove('selected');
    }

    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vectorized.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resetApp = () => {
    setImageSrc(null);
    setSvgString(null);
    setSelectedPath(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">
            <Palette className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight leading-tight">Vectorize.io</h1>
            <p className="text-xs text-gray-500 font-medium">PNG to SVG Converter</p>
          </div>
        </div>
        
        {imageSrc && (
          <button
            onClick={resetApp}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Start Over
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        
        {/* Left Workspace (Upload / Preview) */}
        <div className="lg:col-span-2 flex flex-col gap-4 bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden relative">
          {!imageSrc ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 m-4">
              <div 
                className="w-full max-w-md flex flex-col items-center justify-center p-10 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer mb-8"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                  <Upload className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Upload an Image</h3>
                <p className="text-gray-500 text-sm text-center">
                  Drag and drop a PNG or JPG file here, or click to browse.
                </p>
                <input 
                  type="file" 
                  className="hidden" 
                  ref={fileInputRef}
                  accept="image/png, image/jpeg, image/webp"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFile(e.target.files[0]);
                  }}
                />
              </div>

              <div className="w-full max-w-md flex items-center gap-4 mb-8">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">OR</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              <form onSubmit={handleUrlSubmit} className="w-full max-w-md flex flex-col gap-3">
                <label htmlFor="url-input" className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Link className="w-4 h-4" />
                  Paste an image URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="url-input"
                    type="url"
                    placeholder="https://example.com/image.png"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={isLoadingUrl}
                    required
                  />
                  <button
                    type="submit"
                    disabled={isLoadingUrl || !imageUrlInput}
                    className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {isLoadingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full relative">
              {/* Toolbar */}
              <div className="h-12 border-b border-gray-100 flex items-center px-4 justify-between bg-white shrink-0" dir="rtl">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <ImageIcon className="w-4 h-4" />
                  תצוגת השוואה
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <MousePointer2 className="w-3 h-3" />
                  לחץ על צורה ב-SVG כדי לשנות את צבעה
                </div>
              </div>

              {/* Split Canvas */}
              <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                
                {/* Left Pane: Original Image */}
                <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-gray-200 bg-gray-50/30 relative">
                  <div className="absolute top-3 left-3 bg-white/80 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-semibold text-gray-600 shadow-sm z-10 border border-gray-200/50">
                    Original PNG
                  </div>
                  <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
                    <img 
                      src={imageSrc} 
                      alt="Original" 
                      className="max-w-full max-h-full object-contain shadow-sm rounded-lg bg-white"
                    />
                  </div>
                </div>

                {/* Right Pane: SVG Canvas */}
                <div className="flex-1 flex flex-col bg-gray-50/80 relative">
                  <div className="absolute top-3 left-3 bg-white/80 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-semibold text-blue-600 shadow-sm z-10 border border-blue-100">
                    Vectorized SVG
                  </div>
                  <div className="flex-1 overflow-auto p-6 flex items-center justify-center relative">
                    {isProcessing ? (
                      <div className="flex flex-col items-center justify-center text-blue-600">
                        <Loader2 className="w-10 h-10 animate-spin mb-4" />
                        <p className="font-medium animate-pulse">Vectorizing image...</p>
                        <p className="text-xs text-gray-500 mt-2">This might take a few seconds</p>
                      </div>
                    ) : svgString ? (
                      <div 
                        className="svg-editor-container w-full h-full flex items-center justify-center"
                        dangerouslySetInnerHTML={{ __html: svgString }}
                        onClick={handleSvgClick}
                        ref={svgContainerRef}
                      />
                    ) : null}
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar (Settings & Editor) */}
        <div className="flex flex-col gap-6 overflow-y-auto pb-6">
          
          {/* Settings Panel */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5" dir="rtl">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-gray-700" />
              <h2 className="font-semibold text-gray-900">הגדרות המרה</h2>
            </div>
            
            <div className="bg-blue-50 text-blue-800 text-xs font-medium px-3 py-2 rounded-lg mb-5 border border-blue-100 text-center">
              טרייסניג צבעוני מלא — שומר על צבעי התמונה המקורית
            </div>
            
            <div className="space-y-5">
              {/* Colors */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">מספר צבעים</label>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700" dir="ltr">{settings.numberofcolors}</span>
                </div>
                <input 
                  type="range" min="2" max="64" 
                  value={settings.numberofcolors}
                  onChange={(e) => setSettings({...settings, numberofcolors: parseInt(e.target.value)})}
                  className="w-full accent-blue-600"
                  disabled={!imageSrc || isProcessing}
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>2 (פשוט)</span>
                  <span>64 (מדויק)</span>
                </div>
              </div>

              {/* Line Precision */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">דיוק קווים</label>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700" dir="ltr">{settings.ltres.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0" max="49" 
                  value={49 - ((settings.ltres - 0.1) * 10)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    const ltres = 5.0 - (val / 10);
                    setSettings({...settings, ltres});
                  }}
                  className="w-full accent-blue-600"
                  disabled={!imageSrc || isProcessing}
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>גס</span>
                  <span>מדויק</span>
                </div>
              </div>

              {/* Curve Precision */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">דיוק עקומות</label>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700" dir="ltr">{settings.qtres.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0" max="49" 
                  value={49 - ((settings.qtres - 0.1) * 10)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    const qtres = 5.0 - (val / 10);
                    setSettings({...settings, qtres});
                  }}
                  className="w-full accent-blue-600"
                  disabled={!imageSrc || isProcessing}
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>גס</span>
                  <span>מדויק</span>
                </div>
              </div>

              {/* Remove Small Details */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">הסרת פרטים קטנים</label>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700" dir="ltr">{settings.pathomit}</span>
                </div>
                <input 
                  type="range" min="0" max="32" 
                  value={32 - settings.pathomit}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setSettings({...settings, pathomit: 32 - val});
                  }}
                  className="w-full accent-blue-600"
                  disabled={!imageSrc || isProcessing}
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>פשט</span>
                  <span>שמור הכל</span>
                </div>
              </div>

              {/* Blur */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">טשטוש (הפחתת רעש)</label>
                  <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700" dir="ltr">{settings.blurradius}</span>
                </div>
                <input 
                  type="range" min="0" max="5" 
                  value={5 - settings.blurradius}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setSettings({...settings, blurradius: 5 - val});
                  }}
                  className="w-full accent-blue-600"
                  disabled={!imageSrc || isProcessing}
                />
                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                  <span>חזק</span>
                  <span>ללא</span>
                </div>
              </div>

              {/* Color Sampling Method */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">שיטת דגימת צבעים</label>
                <select 
                  value={settings.colorSampling}
                  onChange={(e) => setSettings({...settings, colorSampling: e.target.value})}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  disabled={!imageSrc || isProcessing}
                >
                  <option value="deterministic">Deterministic (ברירת מחדל)</option>
                  <option value="kmeans">K-Means (מדויק יותר)</option>
                </select>
              </div>

              <button
                onClick={handleApplySettings}
                disabled={!imageSrc || isProcessing}
                className="w-full py-2.5 bg-gray-900 text-white rounded-xl font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
              >
                החל שינויים
              </button>
            </div>
          </div>

          {/* Color Editor Panel */}
          <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 p-5 transition-opacity duration-200 ${!selectedPathId ? 'opacity-50' : 'opacity-100'}`} dir="rtl">
            <div className="flex items-center gap-2 mb-5">
              <Palette className="w-5 h-5 text-gray-700" />
              <h2 className="font-semibold text-gray-900">עורך צבעים</h2>
            </div>
            
            {selectedPathId ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">שנה את הצבע של הצורה שבחרת (השינוי מיידי):</p>
                <div className="flex items-center gap-3">
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shadow-sm shrink-0">
                    <input 
                      type="color" 
                      value={selectedColor}
                      onChange={handleColorChange}
                      className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <input 
                      type="text" 
                      value={selectedColor.toUpperCase()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^#[0-9A-F]{6}$/i.test(val)) {
                          handleColorChange({ target: { value: val } } as any);
                        } else {
                          setSelectedColor(val);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center">
                <MousePointer2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">לחץ על צורה כלשהי בתמונה הווקטורית כדי לערוך את הצבע שלה.</p>
              </div>
            )}
          </div>

          {/* Export Panel */}
          <div className="mt-auto" dir="rtl">
            <button
              onClick={downloadSvg}
              disabled={!svgString || isProcessing}
              className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              הורד קובץ SVG
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}
