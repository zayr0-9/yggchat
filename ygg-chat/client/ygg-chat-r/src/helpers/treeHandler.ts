//store functions for tree management here
//wip

function getMessageChildren(message): number[] {
  return JSON.parse(message.children_ids || '[]')
}

function hasMultipleBranches(message): boolean {
  return getMessageChildren(message).length > 1
}

function getNextChild(parentMessage, currentChildId): number {
  const children = getMessageChildren(parentMessage)
  const currentIndex = children.indexOf(currentChildId)
  return children[(currentIndex + 1) % children.length]
}
