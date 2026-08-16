import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Room } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';
import { useTableControls, TableSearch, SortableTh } from './TableControls';

export const RoomEditor = () => {
  const { t } = useTranslation();
  const { project, updateRooms } = useProject();
  const rooms = project?.rooms || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', capacity: 30 });
  const [typeFilter, setTypeFilter] = useState('');

  const roomTypes = [...new Set(rooms.flatMap(r => r.types))].sort();

  const { query, setQuery, sort, toggleSort, rows: displayedRooms, total, shown } = useTableControls<Room>({
    rows: rooms,
    getSearchText: (room) => `${room.name} ${room.types.join(' ')}`,
    getSortValue: (room, key) => {
      switch (key) {
        case 'name': return room.name;
        case 'capacity': return room.capacity ?? 0;
        case 'types': return room.types.join(', ');
        default: return room.name;
      }
    },
    extraFilter: typeFilter ? (room) => room.types.includes(typeFilter) : undefined,
    defaultSort: { key: 'name', direction: 'asc' },
  });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const room: Room = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      capacity: newItem.capacity,
      types: [],
    };

    updateRooms([...rooms, room]);
    setNewItem({ name: '', capacity: 30 });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm(t('confirm_delete_room'))) {
      updateRooms(rooms.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<Room>) => {
    updateRooms(rooms.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Room[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || row.number || '',
      capacity: parseInt(row.Capacity || row.capacity) || 30,
      types: [],
    })).filter(r => r.name);

    updateRooms([...rooms, ...imported]);
    alert(t('import_success', { count: imported.length }));
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('rooms')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">{t('import_data')}</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_room')}</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="room"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={t('new_room')}
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAdd} className="primary-btn">{t('create_room')}</button>
          </>
        }
      >
        <FormField label={t('room_name')}>
          <input 
            type="text" 
            placeholder="e.g. Room 101 or Physics Lab" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label={t('capacity')}>
          <input 
            type="number" 
            value={newItem.capacity}
            onChange={(e) => setNewItem({ ...newItem, capacity: parseInt(e.target.value) || 0 })}
            min="1"
          />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <select className="table-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">{t('all_types')}</option>
          {roomTypes.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('name')} sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('capacity_students')} sortKey="capacity" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('types')} sortKey="types" sort={sort} onSort={toggleSort} />
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedRooms.map(item => (
            <tr key={item.id}>
              <td>
                <input 
                  type="text" 
                  value={item.name} 
                  onChange={(e) => handleUpdate(item.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input 
                  type="number" 
                  value={item.capacity || ''} 
                  onChange={(e) => handleUpdate(item.id, { capacity: parseInt(e.target.value) || 0 })}
                />
              </td>
              <td>{item.types.join(', ')}</td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">{t('delete')}</button>
              </td>
            </tr>
          ))}
          {displayedRooms.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">{rooms.length === 0 ? t('no_rooms') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
