    return (
        <div
            ref={containerRef}
            className={cn(
                "relative flex w-full h-full overflow-hidden",
                isMpvActive ? "bg-transparent" : "bg-black",
                !showControls && isFullscreen ? "cursor-none" : ""
            )}
            data-component="live-player"
        >
            {/* 1. Left Sidebar (Fixed) */}
            <div
                className={cn(
                    "h-full flex flex-col border-r border-white/5 shrink-0 z-40",
                    isMpvActive ? "bg-black/60 backdrop-blur-md transition-none" : "bg-zinc-950 transition-all duration-300",
                    isSidebarOpen ? "w-64" : "w-0 opacity-0 overflow-hidden border-transparent"
                )}
            >
                {/* Search / Group */}
                <div className={cn("p-3 border-b border-white/5 shrink-0", isMpvActive ? "bg-black/20" : "bg-zinc-900")} style={dragRegionStyle}>
                    <select
                        style={noDragRegionStyle}
                        className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-foreground outline-none transition-colors"
                        value={activeGroup}
                        onChange={(e) => setActiveGroup(e.target.value)}
                    >
                        {groups.map((g) => (
                            <option key={g.groupName} value={g.groupName}>{g.groupName}</option>
                        ))}
                    </select>
                </div>

                {/* Channel List */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 custom-scrollbar">
                    {currentGroupChannels.map((channel, idx) => {
                        const isActive = activeChannel.name === channel.name;
                        return (
                            <button
                                key={`${channel.name}-${idx}`}
                                onClick={() => {
                                    setActiveChannel(channel);
                                    if (isFullscreen) setIsSidebarOpen(false);
                                }}
                                className={cn(
                                    "w-full flex justify-between items-center text-left px-3 py-2.5 rounded-lg transition-all",
                                    isActive
                                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                                        : "bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white"
                                )}
                            >
                                <div className="flex items-center gap-2 truncate">
                                    {channel.logo ? (
                                        <img
                                            src={channel.logo}
                                            alt=""
                                            className="size-4 shrink-0 rounded object-contain"
                                            onError={(e) => (e.currentTarget.style.display = 'none')}
                                        />
                                    ) : (
                                        <TvIcon className={cn("size-4 shrink-0", isActive ? "text-primary-foreground/80" : "text-zinc-600")} />
                                    )}
                                    <span className="text-xs font-medium truncate">{channel.name}</span>
                                </div>
                                {isActive && <PlayIcon className="size-3 shrink-0 text-primary-foreground drop-shadow" />}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* 2. Main Content Area */}
            <div
                className={cn(
                    "flex-1 flex flex-col relative h-full overflow-hidden",
                    isMpvActive ? "bg-transparent transition-none" : "bg-black transition-all duration-300"
                )}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setShowControls(false)}
            >
                {/* Top drag bar */}
                <div
                    data-tauri-drag-region
                    className="absolute top-0 left-0 right-0 h-10 z-[60] flex items-center justify-between px-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-opacity duration-300"
                    style={{ opacity: showControls ? 1 : 0, ...dragRegionStyle }}
                >
                    <div className="flex items-center gap-2 pointer-events-auto" style={noDragRegionStyle}>
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className={cn("p-1.5 rounded-md hover:bg-white/20 text-white transition-colors", isSidebarOpen ? "bg-white/10" : "")}
                        >
                            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                        </button>
                        <span className="text-sm font-medium text-white/90 truncate max-w-[200px] drop-shadow-md">{activeChannel.name}</span>
                        {latency !== null && (
                            <span className="px-1.5 py-0.5 ml-2 rounded bg-green-500/80 text-white text-[10px] font-mono shadow-sm">
                                延迟: {(latency < 0.5 ? 0 : latency).toFixed(1)}s
                            </span>
                        )}
                    </div>

                    <div className="pointer-events-auto" style={noDragRegionStyle}>
                        {onClose && (
                            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-red-500/80 text-white transition-colors border border-white/5 bg-black/20 backdrop-blur-md">
                                <XIcon className="size-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Video Container (Strictly bound to exactly where video should be) */}
                <div
                    ref={videoAreaRef}
                    className={cn(
                        "flex-1 relative overflow-hidden",
                        isMpvActive ? "bg-transparent" : "bg-black"
                    )}
                >
                    <video
                        ref={videoRef}
                        className={cn(
                            "absolute inset-0 w-full h-full outline-none object-contain",
                            isMpvActive ? "opacity-0 pointer-events-none" : ""
                        )}
                        onPlay={handleVideoPlay}
                        onPause={handleVideoPause}
                        onError={handleNativeError}
                        onWaiting={handleVideoWaiting}
                        preload="auto"
                        playsInline
                    />

                    {errorInfo && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
                            <AlertCircleIcon className="size-12 text-red-500 mb-3" />
                            <p className="text-lg text-red-50 font-bold mb-1">播放失败</p>
                            <p className="text-zinc-400 text-xs mb-4">{errorInfo}</p>
                            <button onClick={() => {
                                manualLineLockUntilRef.current = Date.now() + MANUAL_LINE_LOCK_MS;
                                void playLine(0, 0, 0, "manual");
                            }} className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-md text-xs font-medium">
                                重试
                            </button>
                        </div>
                    )}

                    {!isPlaying && !errorInfo && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="size-10 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
                        </div>
                    )}
                </div>

                {/* Bottom Control Bar */}
                <div
                    className={cn(
                        "absolute bottom-0 inset-x-0 flex flex-col border-t border-white/5 shrink-0 z-50 transition-all duration-300",
                        isMpvActive ? "bg-black/60 backdrop-blur-md" : "bg-zinc-950/90 backdrop-blur-md",
                        !showControls ? "translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
                    )}
                >
                    {/* Progress / Buffer Bar */}
                    <div className="w-full h-1 bg-zinc-900 overflow-hidden group cursor-pointer relative">
                        {/* Buffer Fill */}
                        <div
                            className="absolute top-0 left-0 h-full bg-white/20 transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, bufferFillPercent))}%` }}
                        />
                        {/* Fake Live Position Indicator */}
                        <div
                            className="absolute top-0 right-0 h-full w-4 bg-gradient-to-r from-primary/0 to-primary"
                        />
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center justify-between px-4 py-2 text-white">

                        {/* Left Controls */}
                        <div className="flex items-center gap-4">
                            {/* Volume Slider */}
                            <div className="flex items-center gap-2 group flex-1 max-w-24">
                                <svg className="size-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                <input
                                    type="range"
                                    min="0" max="1" step="0.05"
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
                                    onChange={(e) => {
                                        if (videoRef.current) videoRef.current.volume = Number(e.target.value);
                                        if (isMpvActive) {
                                            void setMpvProperty("volume", Number(e.target.value) * 100, MPV_WINDOW_LABEL).catch(() => void 0);
                                        }
                                    }}
                                    defaultValue="1"
                                    title="音量"
                                />
                            </div>
                        </div>

                        {/* Middle Info */}
                        <div className="flex-1 flex justify-center items-center gap-4 text-xs hidden md:flex opacity-70 hover:opacity-100 transition-opacity">
                            <span className={cn("px-2 py-0.5 rounded text-white font-mono flex items-center gap-1", kernelBadgeClass)}>
                                <span className="size-1.5 rounded-full bg-white animate-pulse" />
                                {kernelDisplayName}
                            </span>
                            <span className="text-zinc-400 font-mono flex gap-3">
                                <span>{playbackStateName}</span>
                                <span>缓冲:{bufferAheadSeconds.toFixed(1)}s</span>
                                <span>速率:{isMpvActive ? (mpvBitrate / 8 / 1024).toFixed(0) : backendRateKbps.toFixed(0)}KB/s</span>
                            </span>
                        </div>

                        {/* Right Controls */}
                        <div className="flex items-center gap-2">
                            <select
                                className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 text-xs outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
                                value={lineIndex}
                                onChange={(e) => {
                                    manualLineLockUntilRef.current = Date.now() + MANUAL_LINE_LOCK_MS;
                                    void playLine(Number(e.target.value), 0, 0, "manual");
                                }}
                                title="切换线路"
                            >
                                {activeChannel.urls.map((_, i) => (
                                    <option key={i} value={i}>线路 {i + 1}</option>
                                ))}
                            </select>

                            <select
                                className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 text-xs outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
                                value={hlsKernelMode}
                                onChange={(e) => handleKernelModeChange(e.target.value as HlsKernelMode)}
                                title="播放内核"
                            >
                                {KERNEL_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <button onClick={handleFullscreen} className="p-1.5 ml-1 rounded hover:bg-white/10 text-zinc-300 transition-colors" title="全屏">
                                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {isFullscreen ? (
                                        <><polyline points="8 3 8 8 3 8" /><polyline points="16 3 16 8 21 8" /><polyline points="8 21 8 16 3 16" /><polyline points="16 21 16 16 21 16" /></>
                                    ) : (
                                        <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                                    )}
                                </svg>
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
