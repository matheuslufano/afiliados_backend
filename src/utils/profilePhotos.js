const DICEBEAR_GLASS_URL = 'https://api.dicebear.com/10.x/glass/svg';
const DICEBEAR_ANIMATION_VARIANT = 'medium';

function profileSeed(kind, identity) {
  return `${kind}-${String(identity || 'profile')}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'profile';
}

function profilePhotoUrl(kind, identity) {
  const params = new URLSearchParams({
    seed: profileSeed(kind, identity),
    animationVariant: DICEBEAR_ANIMATION_VARIANT
  });

  return `${DICEBEAR_GLASS_URL}?${params.toString()}`;
}

async function resolveProfilePhotoUrl(kind, identity) {
  return profilePhotoUrl(kind, identity);
}

function isGeneratedDiceBearPhoto(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'api.dicebear.com' &&
      /^\/\d+\.x\/(?:glass|planets|waves|sprouts)\/svg\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function storedProfilePhotoUrl(value, kind, identity) {
  const current = String(value || '').trim();
  if (!current || isGeneratedDiceBearPhoto(current)) {
    return profilePhotoUrl(kind, identity);
  }
  return current;
}

function withProfilePhoto(profile, kind) {
  if (!profile) return profile;
  return {
    ...profile,
    photoUrl: storedProfilePhotoUrl(profile.photoUrl, kind, profile.id || profile.email || profile.name)
  };
}

module.exports = {
  profilePhotoUrl,
  resolveProfilePhotoUrl,
  storedProfilePhotoUrl,
  withProfilePhoto
};
