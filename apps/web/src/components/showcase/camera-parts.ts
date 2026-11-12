export const CAMERA_PARTS = [
  { id: 'housing', name: 'Thân bảo vệ', detail: 'Bảo vệ cảm biến và hệ thống quang học.' },
  {
    id: 'hood',
    name: 'Mái che và vỏ trên',
    detail: 'Hạn chế ánh sáng trực tiếp và bảo vệ cụm camera.',
  },
  { id: 'lens', name: 'Ống kính quang học', detail: 'Hội tụ ánh sáng, tạo hình ảnh cho cảm biến.' },
  {
    id: 'glass',
    name: 'Thấu kính và kính bảo vệ',
    detail: 'Các lớp quang học nằm phía trước cảm biến.',
  },
  { id: 'ir', name: 'Cụm hồng ngoại', detail: 'Minh họa bộ phận hỗ trợ quan sát thiếu sáng.' },
  { id: 'sensor', name: 'Cảm biến hình ảnh', detail: 'Chuyển ánh sáng thành dữ liệu hình ảnh.' },
  { id: 'board', name: 'Bo mạch', detail: 'Minh họa đường truyền hình ảnh tới hệ thống xử lý.' },
  {
    id: 'processor',
    name: 'Xử lý AI của hệ thống',
    detail: 'CameraAI phân tích hình ảnh bằng dịch vụ AI; chip là biểu tượng cho luồng xử lý này.',
  },
  { id: 'mount', name: 'Ngàm gắn camera', detail: 'Giữ camera ở vị trí và góc quan sát đã chọn.' },
  { id: 'fasteners', name: 'Chi tiết lắp ráp', detail: 'Vít và chốt liên kết các cụm linh kiện.' },
] as const;
export type CameraPartId = (typeof CAMERA_PARTS)[number]['id'];
export type CameraCommand = { id: number; action: 'reset' | 'left' | 'right' | 'in' | 'out' };
