import { useState, useRef, useEffect } from 'react';
import { UploadCloud, ListChecks, Download, Camera, ChevronLeft, ChevronRight, Image as ImageIcon, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';

// Bounding box type from API
interface BoundingBox {
  label: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
}

interface ImageFile {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
  boxes: BoundingBox[];
  loadingBoxes: boolean;
}

export default function App() {
  const [manualDescription, setManualDescription] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [activeImgIndex, setActiveImgIndex] = useState<number>(0);
  const [rightTab, setRightTab] = useState<'assign' | 'review'>('assign');
  const [showAnnotations, setShowAnnotations] = useState(true);
  
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeImage = images[activeImgIndex] || null;
  const boxes = activeImage?.boxes || [];
  const loadingBoxes = activeImage?.loadingBoxes || false;

  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);
  const [droppedBoxIndex, setDroppedBoxIndex] = useState<number | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [newBox, setNewBox] = useState<[number, number, number, number] | null>(null);
  const [resizing, setResizing] = useState<{ index: number, handle: 'nw' | 'ne' | 'sw' | 'se' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#10b981', 
    '#0ea5e9', '#6366f1', '#d946ef', '#f43f5e'
  ];

  // reset drop zone when changing image
  useEffect(() => {
    setDroppedBoxIndex(null);
    setSelectedBoxIndex(null);
  }, [activeImgIndex]);

  const updateActiveImageBoxes = (newBoxes: BoundingBox[]) => {
    setImages(prev => prev.map((img, i) => i === activeImgIndex ? { ...img, boxes: newBoxes } : img));
  };

  const setActiveImageLoading = (isLoading: boolean, imgId: string) => {
    setImages(prev => prev.map(img => img.id === imgId ? { ...img, loadingBoxes: isLoading } : img));
  };

  const startCamera = async () => {
    setIsCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera access denied or error:", err);
      alert("Could not access camera. Please check permissions or device capabilities.");
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const takePhoto = () => {
    if (videoRef.current) {
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      const maxDim = 1200;
      let w = vw;
      let h = vh;
      if (w > maxDim || h > maxDim) {
         if (w > h) {
             h = Math.round((h * maxDim) / w);
             w = maxDim;
         } else {
             w = Math.round((w * maxDim) / h);
             h = maxDim;
         }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
            const id = Math.random().toString(36).substring(7);
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
              const newImg: ImageFile = {
                id,
                file,
                preview: objectUrl,
                width: w,
                height: h,
                boxes: [],
                loadingBoxes: false,
              };
              setImages(prev => {
                const newLength = prev.length;
                setTimeout(() => setActiveImgIndex(newLength), 0);
                return [...prev, newImg];
              });
              analyzeImage(file, id);
            };
            img.src = objectUrl;
          }
        }, 'image/jpeg', 0.85);
      }
      stopCamera();
    }
  };

  // Load Image and prepare for API
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach(file => {
      const id = Math.random().toString(36).substring(7);
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const newImg: ImageFile = {
            id,
            file,
            preview: objectUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            boxes: [],
            loadingBoxes: false,
        };
        setImages(prev => {
           const newLength = prev.length;
           setTimeout(() => setActiveImgIndex(newLength), 0);
           return [...prev, newImg];
        });
        analyzeImage(file, id);
      };
      img.src = objectUrl;
    });
    
    // reset selection so input can fire again
    if (imgInputRef.current) imgInputRef.current.value = '';
  };

  const analyzeImage = async (file: File, imgId: string) => {
    setActiveImageLoading(true, imgId);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/analyze-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base64Data,
          mimeType: file.type,
        }),
      });

      const data = await response.json();

      if (data.boxes) {
        const coloredBoxes = (data.boxes as BoundingBox[]).map((b, i) => ({
          ...b,
          color: COLORS[i % COLORS.length]
        }));
        setImages(prev => prev.map(img => img.id === imgId ? { ...img, boxes: coloredBoxes } : img));
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (err: any) {
      console.error("Failed to analyze image", err);
      let errMsg = err.message;
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
        errMsg = "You have exceeded your Gemini API quota. Please wait a bit before trying again.";
      }
      alert("Error analyzing image: " + errMsg);
    } finally {
      setActiveImageLoading(false, imgId);
    }
  };

  const handleLinkItem = () => {
    if (!manualDescription || droppedBoxIndex === null) {
      alert("Please enter an item description and select an object first.");
      return;
    }

    // Update the box label
    if (activeImage && droppedBoxIndex !== null && boxes[droppedBoxIndex]) {
       const updatedBoxes = [...boxes];
       updatedBoxes[droppedBoxIndex].label = manualDescription;
       updateActiveImageBoxes(updatedBoxes);
    }

    // reset product selection but keep drop zone to review
    setManualDescription('');
  };

  const downloadAnnotatedImage = async () => {
    if (!activeImage) return;

    const canvas = document.createElement('canvas');
    canvas.width = activeImage.width;
    canvas.height = activeImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = activeImage.preview;
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    ctx.drawImage(img, 0, 0, activeImage.width, activeImage.height);

    activeImage.boxes.forEach(box => {
      const [ymin, xmin, ymax, xmax] = box.box_2d;
      const x = (xmin / 1000) * activeImage.width;
      const y = (ymin / 1000) * activeImage.height;
      const w = ((xmax - xmin) / 1000) * activeImage.width;
      const h = ((ymax - ymin) / 1000) * activeImage.height;

      ctx.lineWidth = Math.max(2, activeImage.width * 0.003);
      ctx.strokeStyle = box.color || '#00FFFF';
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = '#FFF'; 
      const fontSize = Math.max(12, activeImage.width * 0.015);
      ctx.font = `bold ${fontSize}px sans-serif`;
      
      const textPadding = fontSize * 0.4;
      const textWidth = ctx.measureText(box.label).width;
      
      ctx.fillStyle = box.color || '#00FFFF';
      ctx.fillRect(x, y - fontSize - textPadding * 2, textWidth + textPadding * 2, fontSize + textPadding * 2);
      
      ctx.fillStyle = '#FFF'; 
      ctx.textBaseline = 'middle';
      ctx.fillText(box.label, x + textPadding, y - fontSize / 2 - textPadding);
    });

    const link = document.createElement('a');
    link.download = `annotated_${activeImage.file.name}`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    e.preventDefault();
    if (!imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1000;
    const y = ((e.clientY - rect.top) / rect.height) * 1000;

    setIsDrawing(true);
    setNewBox([y, x, y, x]);
    setSelectedBoxIndex(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgContainerRef.current) return;
    const rect = imgContainerRef.current.getBoundingClientRect();
    
    let x = ((e.clientX - rect.left) / rect.width) * 1000;
    let y = ((e.clientY - rect.top) / rect.height) * 1000;
    x = Math.max(0, Math.min(1000, x));
    y = Math.max(0, Math.min(1000, y));

    if (isDrawing && newBox) {
      setNewBox([newBox[0], newBox[1], y, x]);
    } else if (resizing) {
      const newBoxes = [...boxes];
      let [ymin, xmin, ymax, xmax] = newBoxes[resizing.index].box_2d;
      if (resizing.handle.includes('n')) ymin = Math.min(y, ymax - 10);
      if (resizing.handle.includes('s')) ymax = Math.max(y, ymin + 10);
      if (resizing.handle.includes('w')) xmin = Math.min(x, xmax - 10);
      if (resizing.handle.includes('e')) xmax = Math.max(x, xmin + 10);
      newBoxes[resizing.index].box_2d = [ymin, xmin, ymax, xmax];
      updateActiveImageBoxes(newBoxes);
    }
  };

  const handlePointerUp = () => {
    if (resizing) {
      setResizing(null);
      return;
    }
    if (isDrawing && newBox) {
      const [y1, x1, y2, x2] = newBox;
      const ymin = Math.min(y1, y2);
      const ymax = Math.max(y1, y2);
      const xmin = Math.min(x1, x2);
      const xmax = Math.max(x1, x2);
      
      if (ymax - ymin > 10 && xmax - xmin > 10) {
        const newBoundingBox: BoundingBox = {
          label: 'Pending Assignment',
          box_2d: [ymin, xmin, ymax, xmax],
          color: COLORS[boxes.length % COLORS.length]
        };
        updateActiveImageBoxes([...boxes, newBoundingBox]);
        setSelectedBoxIndex(boxes.length);
        setDroppedBoxIndex(boxes.length);
      }
    }
    setIsDrawing(false);
    setNewBox(null);
  };

  const imgCropStyle = (box: [number, number, number, number]) => {
    const [ymin, xmin, ymax, xmax] = box;
    const widthRatio = 1000 / Math.max(1, (xmax - xmin));
    const heightRatio = 1000 / Math.max(1, (ymax - ymin));
    return {
      width: `${widthRatio * 100}%`,
      height: `${heightRatio * 100}%`,
      left: `-${(xmin / 1000) * widthRatio * 100}%`,
      top: `-${(ymin / 1000) * heightRatio * 100}%`,
      position: 'absolute' as const,
      maxWidth: 'none',
      objectFit: 'fill' as const
    };
  };

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#E0E0E0] font-sans flex flex-col p-4 sm:p-6 lg:p-8 select-none">
      {/* Header */}
      <header className="flex justify-between items-end border-b border-[#333] pb-4 mb-6 shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] tracking-[0.3em] text-[#666] uppercase mb-1 font-bold">System v.4.02 / Network Active</span>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tighter leading-none">VISUAL LOGISTICS <span className="text-[#F27D26]">COORDINATOR</span></h1>
        </div>
        <div className="hidden sm:flex gap-8 items-end">
          <div className="text-right">
            <p className="text-[10px] text-[#666] uppercase tracking-wider">Annotation Mode</p>
            <p className="text-xl font-mono leading-none text-[#F27D26]">MULTI_MODAL</p>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
        
        {/* Left Column - Image & Actions */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
          <section className="bg-[#141414] border border-[#222] p-4 sm:p-6 flex flex-col relative overflow-hidden flex-1">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#F27D26]"></div>
            <h2 className="text-xs font-bold tracking-widest text-[#666] uppercase mb-4 flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#F27D26]" /> 1. Upload Workpiece Image
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
              <div 
                className="border-2 border-dashed border-[#333] rounded-lg p-6 sm:p-8 text-center cursor-pointer hover:border-[#F27D26] transition-colors flex flex-col items-center justify-center bg-black/20"
                onClick={startCamera}
              >
                <Camera className="w-8 h-8 text-[#666] mb-3" />
                <p className="text-sm font-medium text-[#E0E0E0]">Use Camera</p>
                <p className="text-xs text-[#888] mt-1 font-mono">Take Photo Now</p>
              </div>

              <div 
                className="border-2 border-dashed border-[#333] rounded-lg p-6 sm:p-8 text-center cursor-pointer hover:border-[#F27D26] transition-colors flex flex-col items-center justify-center bg-black/20"
                onClick={() => imgInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  className="hidden" 
                  ref={imgInputRef} 
                  accept="image/*" 
                  multiple
                  onChange={handleImageUpload} 
                />
                <UploadCloud className="w-8 h-8 text-[#666] mb-3" />
                <p className="text-sm font-medium text-[#E0E0E0]">Upload Image(s)</p>
                <p className="text-xs text-[#888] mt-1 font-mono">JPEG, PNG</p>
              </div>
            </div>

            {images.length > 0 && (
              <div className="mt-4 border-t border-[#333] pt-4">
                <p className="text-[10px] text-[#888] tracking-widest uppercase mb-2 flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> Uploaded Workpieces ({images.length})
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                  {images.map((img, i) => (
                     <div 
                       key={img.id}
                       onClick={() => { setActiveImgIndex(i); setSelectedBoxIndex(null); }}
                       className={`w-16 h-16 shrink-0 rounded-sm cursor-pointer border-2 bg-black relative ${i === activeImgIndex ? 'border-[#F27D26]' : 'border-transparent opacity-50 hover:opacity-100'}`}
                     >
                       <img src={img.preview} alt={`Preview ${i}`} className="w-full h-full object-cover" />
                       <span className="absolute top-0 left-0 bg-black/60 text-white text-[8px] font-mono px-1 m-0.5">{i + 1}</span>
                     </div>
                  ))}
                </div>
              </div>
            )}

            {activeImage && (
              <div className="mt-6 flex-1 relative bg-[#1A1A1A] border border-[#333] rounded-sm overflow-hidden flex items-center justify-center min-h-[300px]">
                <div className="absolute inset-0 bg-[#080808] opacity-50 pointer-events-none"></div>
                <div 
                  className="relative inline-block border border-[#444] bg-[#222] shadow-2xl z-10 max-w-full max-h-[60vh] select-none touch-none cursor-crosshair"
                  ref={imgContainerRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                >
                  <img src={activeImage.preview} alt="Workpiece" className="max-h-[60vh] object-contain block max-w-full pointer-events-none" draggable={false} />
                  
                  {loadingBoxes && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-40">
                      <div className="bg-[#111] border border-[#333] rounded-sm px-6 py-4 shadow-2xl flex flex-col items-center gap-3">
                        <div className="w-6 h-6 border-[3px] border-[#F27D26] border-t-transparent rounded-full animate-spin" />
                        <span className="text-[10px] font-mono tracking-widest uppercase text-[#F27D26]">Detecting items...</span>
                      </div>
                    </div>
                  )}

                  {/* Bounding Boxes Layer */}
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {showAnnotations && boxes.map((b, idx) => {
                      // scale from 0-1000 to percentages
                      const [ymin, xmin, ymax, xmax] = b.box_2d;
                      const top = `${(ymin / 1000) * 100}%`;
                      const left = `${(xmin / 1000) * 100}%`;
                      const height = `${((ymax - ymin) / 1000) * 100}%`;
                      const width = `${((xmax - xmin) / 1000) * 100}%`;

                      const isSelected = selectedBoxIndex === idx;

                      return (
                        <div 
                          key={idx}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('boxIndex', idx.toString());
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setSelectedBoxIndex(idx);
                            setDroppedBoxIndex(idx);
                          }}
                          className={`absolute border-2 pointer-events-auto cursor-pointer transition-colors duration-200 ${isSelected ? 'z-20 shadow-xl' : 'opacity-80 hover:opacity-100'}`}
                          style={{ 
                            top, left, width, height,
                            borderColor: b.color || '#00FFFF',
                            backgroundColor: isSelected ? `${b.color || '#00FFFF'}40` : `${b.color || '#00FFFF'}15`
                          }}
                        >
                          <span 
                            className={`absolute top-0 left-0 text-white text-[10px] font-bold px-1 whitespace-nowrap overflow-hidden text-ellipsis`}
                            style={{ backgroundColor: b.color || '#00FFFF', maxWidth: '100%' }}
                          >
                            {b.label}
                          </span>
                          {/* Remove button */}
                          {isSelected && (
                            <button
                              onClick={(e) => { e.stopPropagation(); updateActiveImageBoxes(boxes.filter((_, i) => i !== idx)); setSelectedBoxIndex(null); setDroppedBoxIndex(null); }}
                              className="absolute -top-6 right-0 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-sm hover:bg-red-600 pointer-events-auto shadow-md"
                            >
                              ✕
                            </button>
                          )}
                          {/* Resize Handles */}
                          {isSelected && (
                             <>
                               <div 
                                 className="resize-handle absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border cursor-nwse-resize pointer-events-auto"
                                 style={{ borderColor: b.color || '#00FFFF' }}
                                 onPointerDown={(e) => { e.stopPropagation(); setResizing({ index: idx, handle: 'nw' }); }}
                               ></div>
                               <div 
                                 className="resize-handle absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border cursor-nesw-resize pointer-events-auto"
                                 style={{ borderColor: b.color || '#00FFFF' }}
                                 onPointerDown={(e) => { e.stopPropagation(); setResizing({ index: idx, handle: 'ne' }); }}
                               ></div>
                               <div 
                                 className="resize-handle absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border cursor-nesw-resize pointer-events-auto"
                                 style={{ borderColor: b.color || '#00FFFF' }}
                                 onPointerDown={(e) => { e.stopPropagation(); setResizing({ index: idx, handle: 'sw' }); }}
                               ></div>
                               <div 
                                 className="resize-handle absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border cursor-nwse-resize pointer-events-auto"
                                 style={{ borderColor: b.color || '#00FFFF' }}
                                 onPointerDown={(e) => { e.stopPropagation(); setResizing({ index: idx, handle: 'se' }); }}
                               ></div>
                             </>
                          )}
                        </div>
                      );
                    })}

                    {/* New Box Drawing Layer */}
                    {isDrawing && newBox && (
                      <div 
                        className="absolute border-2 border-dashed border-[#F27D26] bg-[#F27D26]/20 pointer-events-none z-30"
                        style={{
                          top: `${(Math.min(newBox[0], newBox[2]) / 1000) * 100}%`,
                          left: `${(Math.min(newBox[1], newBox[3]) / 1000) * 100}%`,
                          height: `${(Math.abs(newBox[2] - newBox[0]) / 1000) * 100}%`,
                          width: `${(Math.abs(newBox[3] - newBox[1]) / 1000) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
                
                {/* Canvas Overlays */}
                <div className="absolute top-4 left-4 flex gap-2 pointer-events-none z-30 hidden sm:flex">
                  {showAnnotations && <span className="bg-black/80 px-2 py-1 text-[9px] font-mono border border-white/20 uppercase text-white">Scanner Active</span>}
                  <span className="bg-[#F27D26]/20 px-2 py-1 text-[9px] font-mono border border-[#F27D26] uppercase text-[#F27D26]">Image {activeImgIndex + 1} of {images.length}</span>
                </div>

                <div className="absolute top-4 right-4 z-30">
                  <button
                    onClick={() => setShowAnnotations(!showAnnotations)}
                    className="bg-black/70 hover:bg-[#F27D26] text-white p-2 rounded border border-white/20 transition-colors pointer-events-auto"
                    title={showAnnotations ? "Hide Annotations" : "Show Annotations"}
                  >
                    {showAnnotations ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {images.length > 1 && (
                  <>
                    <button 
                      onClick={() => { setActiveImgIndex(i => Math.max(0, i - 1)); setSelectedBoxIndex(null); }}
                      disabled={activeImgIndex === 0}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-30 bg-black/50 hover:bg-[#F27D26] text-white p-2 rounded-full border border-white/20 transition-colors disabled:opacity-30 disabled:hover:bg-black/50 cursor-pointer pointer-events-auto"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button 
                      onClick={() => { setActiveImgIndex(i => Math.min(images.length - 1, i + 1)); setSelectedBoxIndex(null); }}
                      disabled={activeImgIndex === images.length - 1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-30 bg-black/50 hover:bg-[#F27D26] text-white p-2 rounded-full border border-white/20 transition-colors disabled:opacity-30 disabled:hover:bg-black/50 cursor-pointer pointer-events-auto"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column - Data & Mapping */}
        <div className="lg:col-span-4 flex flex-col border border-[#333] rounded-sm overflow-hidden h-[calc(100vh-120px)] lg:h-auto">
          {/* Tabs */}
          <div className="flex bg-[#111] shrink-0 border-b border-[#333]">
            <button 
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors ${rightTab === 'assign' ? 'bg-[#F27D26] text-black' : 'text-[#888] hover:text-[#fff] hover:bg-[#222]'}`}
              onClick={() => setRightTab('assign')}
            >
              Assign Identity
            </button>
            <button 
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${rightTab === 'review' ? 'bg-[#F27D26] text-black' : 'text-[#888] hover:text-[#fff] hover:bg-[#222]'}`}
              onClick={() => setRightTab('review')}
            >
              Review Objects {boxes.length > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-mono ${rightTab === 'review' ? 'bg-black text-[#F27D26]' : 'bg-[#333] text-white'}`}>{boxes.length}</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#1a1a1a]">
            {rightTab === 'assign' && (
              <section className="bg-[#F27D26] p-4 sm:p-5 text-black flex flex-col min-h-full">
                <h2 className="text-xs font-black tracking-widest uppercase mb-3 italic flex items-center gap-2">
                  <ListChecks className="w-4 h-4" /> Assign Item Identity
                </h2>
    
                <div 
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const boxIdxStr = e.dataTransfer.getData('boxIndex');
                    if (boxIdxStr) {
                      const idx = parseInt(boxIdxStr, 10);
                      setDroppedBoxIndex(idx);
                      setSelectedBoxIndex(idx);
                    }
                  }}
                  className="w-full h-32 border-2 border-dashed border-black/30 bg-black/10 mb-4 rounded-sm flex items-center justify-center relative overflow-hidden shrink-0"
                >
                  {droppedBoxIndex !== null && activeImage && boxes[droppedBoxIndex] ? (
                    <div className="relative w-full h-full bg-[#111]">
                      <img 
                        src={activeImage.preview} 
                        style={imgCropStyle(boxes[droppedBoxIndex].box_2d)} 
                        alt="Cropped Preview"
                      />
                      <div className="absolute inset-0 border-[4px]" style={{ borderColor: boxes[droppedBoxIndex].color || '#000' }}></div>
                    </div>
                  ) : (
                    <p className="text-xs text-black/60 font-mono tracking-widest uppercase text-center px-4">
                      Identify Object<br/><br/>Click an object in image<br/>or drag it here
                    </p>
                  )}
                </div>
                
                <div className="space-y-4 flex-1">
                  <div className="bg-black/10 p-4 rounded-sm border border-black/10">
                    <label className="text-[10px] uppercase font-bold mb-1 block text-black/80">
                      Item Description
                    </label>
                    <input 
                      type="text"
                      className="w-full bg-white border-none text-sm font-bold p-3 focus:ring-0 outline-none text-black shadow-sm placeholder-black/30"
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      placeholder="Enter equipment description..."
                      disabled={droppedBoxIndex === null}
                    />
                  </div>
    
                  {droppedBoxIndex !== null && manualDescription && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-black/20 p-4 rounded-sm mt-3 border border-black/10"
                    >
                      <p className="text-[10px] text-black/70 uppercase mb-1 font-bold">Manual Object Entry</p>
                      <h3 className="font-bold text-black text-xl tracking-tight leading-tight uppercase">
                        {manualDescription}
                      </h3>
                    </motion.div>
                  )}
    
                  <button
                    onClick={handleLinkItem}
                    disabled={!manualDescription || !activeImage || droppedBoxIndex === null}
                    className="w-full bg-black text-white font-bold py-3 mt-3 text-xs uppercase tracking-[0.2em] hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Verify & Assign
                  </button>
                </div>
              </section>
            )}

            {rightTab === 'review' && (
              <section className="p-4 sm:p-5 text-white flex flex-col min-h-full">
                <h2 className="text-xs font-black tracking-widest text-[#F27D26] uppercase mb-4 flex items-center gap-2">
                  <ListChecks className="w-4 h-4" /> Marked Objects
                </h2>
                {boxes.length === 0 ? (
                   <p className="text-[#666] text-sm text-center mt-10">No objects marked yet.</p>
                ) : (
                  <div className="space-y-2">
                    {boxes.map((box, idx) => (
                      <div 
                        key={idx} 
                        className={`flex items-center justify-between p-3 border cursor-pointer transition-colors ${selectedBoxIndex === idx ? 'border-[#F27D26] bg-[#222]' : 'border-[#333] bg-[#111] hover:border-[#555]'}`}
                        onClick={() => {
                          setSelectedBoxIndex(idx);
                          setDroppedBoxIndex(idx);
                          setRightTab('assign');
                        }}
                      >
                         <div className="flex items-center gap-3">
                           <div className="w-4 h-4 border shrink-0" style={{ backgroundColor: box.color, borderColor: box.color }}></div>
                           <span className="text-sm font-bold truncate max-w-[200px]">{box.label}</span>
                         </div>
                         <button 
                           onClick={(e) => {
                             e.stopPropagation();
                             updateActiveImageBoxes(boxes.filter((_, i) => i !== idx));
                             if (selectedBoxIndex === idx) {
                               setSelectedBoxIndex(null);
                               setDroppedBoxIndex(null);
                             }
                           }}
                           className="p-1.5 text-[#666] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                         >
                           ✕
                         </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Action Button Footer area */}
        {images.length > 0 && (
          <footer className="col-span-1 border-t border-[#333] pt-4 shrink-0 lg:col-span-12 flex justify-end">
             <button
                onClick={downloadAnnotatedImage}
                disabled={!activeImage || activeImage.boxes.length === 0}
                className="bg-[#222] hover:bg-[#333] text-white font-bold py-3 px-6 text-xs uppercase tracking-[0.2em] transition-colors disabled:opacity-50 flex items-center gap-2 border border-[#444]"
              >
                <Download className="w-4 h-4" /> Export Identifications
              </button>
          </footer>
        )}
      </main>

      {/* Camera UI Fullscreen */}
      {isCameraActive && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex justify-between items-center p-4 bg-black/80">
            <h2 className="text-white font-bold text-sm tracking-widest uppercase flex items-center gap-2">
               <Camera className="w-4 h-4 text-[#F27D26]" /> Active Camera
            </h2>
            <button 
              onClick={stopCamera} 
              className="text-white bg-red-500/20 px-3 py-1.5 text-xs uppercase tracking-widest font-bold rounded hover:bg-red-500/50 transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute inset-0 pointer-events-none border-[1px] border-[#F27D26]/30 m-6 flex items-center justify-center">
              <div className="w-16 h-16 border-2 border-[#F27D26]/80 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-[#F27D26]/80 rounded-full" />
              </div>
            </div>
          </div>
          <div className="p-6 bg-black/90 flex justify-center pb-8 border-t border-[#333]">
            <button 
              onClick={takePhoto}
              className="w-16 h-16 bg-transparent border-[4px] border-white rounded-full flex items-center justify-center group active:scale-95 transition-all"
            >
               <div className="w-12 h-12 bg-white rounded-full group-active:bg-gray-300 transition-colors" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
