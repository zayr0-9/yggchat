/**
 * Utility functions for managing favorited models in localStorage
 */

export type FavoritedModels = string[]

/**
 * Read favorited models from localStorage
 * @returns Array of favorited model names
 */
export const getFavoritedModels = (): FavoritedModels => {
  try {
    const stored = localStorage.getItem('favoritedModels')
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn('Failed to read favorited models from localStorage:', error)
    return []
  }
}

/**
 * Save favorited models to localStorage
 * @param favorites Array of model names to save
 */
export const setFavoritedModels = (favorites: FavoritedModels): void => {
  try {
    localStorage.setItem('favoritedModels', JSON.stringify(favorites))
  } catch (error) {
    console.error('Failed to save favorited models to localStorage:', error)
  }
}

/**
 * Check if a model is favorited
 * @param modelName Name of the model to check
 * @param favorites Array of favorited model names
 * @returns true if the model is favorited
 */
export const isModelFavorited = (modelName: string, favorites: FavoritedModels): boolean => {
  return favorites.includes(modelName)
}

/**
 * Toggle favorite status of a model
 * @param modelName Name of the model to toggle
 * @param favorites Current array of favorited model names
 * @returns Updated array of favorited model names
 */
export const toggleModelFavorite = (modelName: string, favorites: FavoritedModels): FavoritedModels => {
  const isFavorited = favorites.includes(modelName)
  if (isFavorited) {
    // Remove from favorites
    return favorites.filter(name => name !== modelName)
  } else {
    // Add to favorites
    return [...favorites, modelName]
  }
}
