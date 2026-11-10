CREATE TABLE "SiteThemeSetting" (
    "scope" TEXT NOT NULL,
    "themeId" TEXT NOT NULL DEFAULT 'christmas',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteThemeSetting_pkey" PRIMARY KEY ("scope"),
    CONSTRAINT "SiteThemeSetting_scope_check" CHECK ("scope" IN ('blog', 'institutional'))
);
