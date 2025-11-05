// import React from 'react'
// import { PermissionRequest } from '../../features/chats/chatTypes'

// interface PermissionRequestModalProps {
//   request: PermissionRequest | null
//   responding: boolean
//   onGrant: () => void
//   onDeny: () => void
//   onClose: () => void
// }

// export const PermissionRequestModal: React.FC<PermissionRequestModalProps> = ({
//   request,
//   responding,
//   onGrant,
//   onDeny,
//   onClose,
// }) => {
//   if (!request) return null

//   return (
//     <div className='fixed inset-0 z-50 flex items-center justify-center'>
//       {/* Overlay */}
//       <div
//         className='fixed inset-0 bg-neutral-900/50 backdrop-blur-sm'
//         onClick={responding ? undefined : onClose}
//       />

//       {/* Modal */}
//       <div
//         className='relative z-50 mx-4 max-w-2xl rounded-2xl px-8 py-6 bg-white dark:bg-yBlack-900 shadow-xl border border-neutral-200 dark:border-neutral-800'
//         onClick={e => e.stopPropagation()}
//       >
//         <div className='flex items-start gap-4'>
//           {/* Icon */}
//           <div className='flex-shrink-0 w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center'>
//             <i className='bx bx-shield-quarter text-2xl text-amber-600 dark:text-amber-400'></i>
//           </div>

//           {/* Content */}
//           <div className='flex-1'>
//             <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2'>
//               Permission Required
//             </h2>

//             <p className='text-gray-700 dark:text-gray-300 mb-4'>
//               Claude Code is requesting permission to execute:
//             </p>

//             <div className='bg-neutral-100 dark:bg-neutral-800 rounded-lg p-4 mb-6'>
//               <div className='mb-3'>
//                 <span className='text-sm font-medium text-gray-600 dark:text-gray-400'>Tool:</span>
//                 <span className='ml-2 text-sm text-gray-900 dark:text-gray-100 font-mono'>
//                   {request.toolName}
//                 </span>
//               </div>

//               {request.filePath && (
//                 <div className='mb-3'>
//                   <span className='text-sm font-medium text-gray-600 dark:text-gray-400'>File:</span>
//                   <span className='ml-2 text-sm text-gray-900 dark:text-gray-100 font-mono break-all'>
//                     {request.filePath}
//                   </span>
//                 </div>
//               )}

//               <div>
//                 <span className='text-sm font-medium text-gray-600 dark:text-gray-400'>Details:</span>
//                 <p className='mt-1 text-sm text-gray-900 dark:text-gray-100 break-words'>
//                   {request.message}
//                 </p>
//               </div>
//             </div>

//             {/* Actions */}
//             <div className='flex gap-3 justify-end'>
//               <button
//                 onClick={onDeny}
//                 disabled={responding}
//                 className='px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
//               >
//                 Deny
//               </button>
//               <button
//                 onClick={onGrant}
//                 disabled={responding}
//                 className='px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
//               >
//                 {responding ? 'Processing...' : 'Grant Permission'}
//               </button>
//             </div>
//           </div>

//           {/* Close button */}
//           <button
//             onClick={onClose}
//             disabled={responding}
//             className='absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'
//           >
//             <i className='bx bx-x text-2xl'></i>
//           </button>
//         </div>
//       </div>
//     </div>
//   )
// }
