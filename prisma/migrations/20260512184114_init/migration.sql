-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Link" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "originalUrl" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Click" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "clickedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkId" INTEGER NOT NULL,
    CONSTRAINT "Click_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Link_shortCode_key" ON "Link"("shortCode");
